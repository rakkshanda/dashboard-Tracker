#!/usr/bin/env python3
"""
Sticky Schedule — floating NSPanel menubar app.
Always on top including fullscreen. Draggable via titlebar. Resizable.
"""

import objc, json, os, sys

from Foundation import (NSObject, NSTimer, NSURL, NSMakeRect, NSMakeSize,
                         NSRunLoop)
from AppKit import (NSApplication, NSStatusBar, NSVariableStatusItemLength,
                    NSPanel, NSViewController, NSColor, NSMenu, NSMenuItem,
                    NSWorkspace, NSWindowStyleMaskBorderless,
                    NSWindowStyleMaskResizable, NSBackingStoreBuffered)
from WebKit import (WKWebView, WKWebViewConfiguration,
                    WKUserContentController, WKUserScript,
                    WKUserScriptInjectionTimeAtDocumentStart)
from Quartz import CGShieldingWindowLevel

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
HTML_FILE  = os.path.join(SCRIPT_DIR, 'sticky_web.html')
POS_FILE   = os.path.join(SCRIPT_DIR, '.sticky_pos')
DBG_FILE   = os.path.join(SCRIPT_DIR, '.sticky_debug')

def dbg(msg):
    sys.stderr.write(f'[sticky] {msg}\n'); sys.stderr.flush()
    with open(DBG_FILE, 'a') as f: f.write(f'{msg}\n')

def load_pos():
    try:
        with open(POS_FILE) as f:
            d = json.load(f)
            return d.get('x',80), d.get('y',80), d.get('w',310), d.get('h',560)
    except Exception:
        # default: bottom-left corner
        from AppKit import NSScreen
        screen = NSScreen.mainScreen().frame()
        return 20, 20, 310, 560

def save_pos(panel):
    try:
        f = panel.frame()
        with open(POS_FILE, 'w') as fp:
            json.dump({'x': int(f.origin.x), 'y': int(f.origin.y),
                       'w': int(f.size.width), 'h': int(f.size.height)}, fp)
    except Exception:
        pass


class AppDelegate(NSObject):

    def applicationDidFinishLaunching_(self, _):
        NSApplication.sharedApplication().setActivationPolicy_(2)  # Accessory
        self._hidden = False
        self._panel  = None
        self._setup()

    def _setup(self):
        x, y, w, h = load_pos()
        LEVEL = CGShieldingWindowLevel()
        dbg(f'level={LEVEL}')

        # ── WKWebView ──────────────────────────────────────────────────────────
        uc = WKUserContentController.alloc().init()
        uc.addScriptMessageHandler_name_(self, 'sticky')

        # polyfill so HTML close button works without pywebview
        shim = ("window.pywebview={api:{close:function(){"
                "window.webkit.messageHandlers.sticky.postMessage({action:'close'})}}};")
        script = WKUserScript.alloc().initWithSource_injectionTime_forMainFrameOnly_(
            shim, WKUserScriptInjectionTimeAtDocumentStart, True)
        uc.addUserScript_(script)

        cfg = WKWebViewConfiguration.alloc().init()
        cfg.setUserContentController_(uc)

        wv = WKWebView.alloc().initWithFrame_configuration_(
            NSMakeRect(0, 0, w, h), cfg)
        wv.setAutoresizingMask_(18)          # width + height sizable
        wv.setValue_forKey_(False, 'drawsBackground')  # transparent webview
        wv.setWantsLayer_(True)
        wv.layer().setCornerRadius_(14.0)   # match CSS border-radius
        wv.layer().setMasksToBounds_(True)  # clip corners at CA layer level
        wv.loadFileURL_allowingReadAccessToURL_(
            NSURL.fileURLWithPath_(HTML_FILE),
            NSURL.fileURLWithPath_(SCRIPT_DIR))
        self._webview = wv
        dbg('webview loaded')

        # ── NSPanel ────────────────────────────────────────────────────────────
        style = NSWindowStyleMaskBorderless | NSWindowStyleMaskResizable
        panel = NSPanel.alloc().initWithContentRect_styleMask_backing_defer_(
            NSMakeRect(x, y, w, h), style, NSBackingStoreBuffered, False)

        panel.setLevel_(LEVEL)
        panel.setCollectionBehavior_(1 | 256)   # CanJoinAllSpaces | FullScreenAuxiliary
        panel.setHidesOnDeactivate_(False)
        panel.setOpaque_(False)
        panel.setBackgroundColor_(NSColor.clearColor())
        panel.setMovable_(True)                 # required for drag to work on borderless windows
        panel.setMovableByWindowBackground_(True)
        panel.setContentView_(wv)
        panel.setMinSize_(NSMakeSize(80, 80))
        panel.setDelegate_(self)
        panel.makeKeyAndOrderFront_(None)
        self._panel = panel
        dbg('panel shown')

        # ── Keep-alive NSTimer ─────────────────────────────────────────────────
        NSTimer.scheduledTimerWithTimeInterval_target_selector_userInfo_repeats_(
            0.5, self, 'raisePanel:', None, True)

        # ── Space-change observer ──────────────────────────────────────────────
        wsnc = NSWorkspace.sharedWorkspace().notificationCenter()
        wsnc.addObserver_selector_name_object_(
            self, 'spaceChanged:',
            'NSWorkspaceActiveSpaceDidChangeNotification', None)

        # ── Status bar icon ────────────────────────────────────────────────────
        bar  = NSStatusBar.systemStatusBar()
        item = bar.statusItemWithLength_(NSVariableStatusItemLength)
        item.button().setTitle_('◉')
        item.button().setToolTip_('Sticky Schedule — click to show/hide')
        item.button().setTarget_(self)
        item.button().setAction_('togglePanel:')
        self._status_item = item
        dbg('ready')

    # ── timer / space ──────────────────────────────────────────────────────────
    def raisePanel_(self, _):
        if self._hidden or not self._panel:
            return
        p = self._panel
        p.setLevel_(CGShieldingWindowLevel())
        p.setCollectionBehavior_(1 | 256)
        p.setHidesOnDeactivate_(False)
        p.orderFrontRegardless()

    def spaceChanged_(self, _):
        dbg('space changed')
        self.raisePanel_(None)

    # ── toggle ─────────────────────────────────────────────────────────────────
    def togglePanel_(self, _):
        if self._hidden:
            self._hidden = False
            self.raisePanel_(None)
        else:
            self._hidden = True
            self._panel.orderOut_(None)

    # ── close from HTML ────────────────────────────────────────────────────────
    def userContentController_didReceiveScriptMessage_(self, _, msg):
        body = msg.body()
        if not isinstance(body, dict):
            return
        action = body.get('action')
        if action == 'dragstart':
            dbg('dragstart received')
        elif action == 'close':
            save_pos(self._panel)
            NSApplication.sharedApplication().terminate_(None)
        elif action == 'move':
            dx = body.get('dx', 0)
            dy = body.get('dy', 0)
            dbg(f'move dx={dx} dy={dy}')
            f = self._panel.frame()
            nx = f.origin.x + dx
            ny = f.origin.y - dy   # Cocoa Y is bottom-up
            self._panel.setFrameOrigin_((nx, ny))

    # ── save position on window move/resize ───────────────────────────────────
    def windowDidMove_(self, _):
        if self._panel: save_pos(self._panel)

    def windowDidResize_(self, _):
        if self._panel: save_pos(self._panel)


open(DBG_FILE, 'w').close()
dbg('starting')

app = NSApplication.sharedApplication()
delegate = AppDelegate.alloc().init()
app.setDelegate_(delegate)
app.run()
