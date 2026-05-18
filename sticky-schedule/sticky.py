#!/usr/bin/env python3
"""Floating schedule + goals sticky — reads/writes Supabase app_kv table."""

import tkinter as tk
import urllib.request
import ssl
import json
import threading
import os
from datetime import datetime

# ── SSL (macOS cert fix) ──────────────────────────────────────────────────────
_SSL = ssl.create_default_context()
_SSL.check_hostname = False
_SSL.verify_mode = ssl.CERT_NONE

# ── Supabase ──────────────────────────────────────────────────────────────────
SUPABASE_URL = 'https://dmzonyrwdqzugsshcxgb.supabase.co'
SUPABASE_KEY = (
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6'
    'ImRtem9ueXJ3ZHF6dWdzc2hjeGdiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjExNzgz'
    'NTgsImV4cCI6MjA3Njc1NDM1OH0.0MYp26X7h1JR_r4KO-p_f3aX-dsiaO6Z9ZS8rjU9e7g'
)
HEADERS = {'apikey': SUPABASE_KEY, 'Authorization': f'Bearer {SUPABASE_KEY}'}

def fetch_kv(key):
    url = f"{SUPABASE_URL}/rest/v1/app_kv?select=value&key=eq.{key}"
    req = urllib.request.Request(url, headers=HEADERS)
    try:
        with urllib.request.urlopen(req, timeout=6, context=_SSL) as r:
            data = json.loads(r.read())
            return data[0]['value'] if data else None
    except Exception as e:
        print(f"fetch error: {e}")
        return None

def upsert_kv(key, value):
    url = f"{SUPABASE_URL}/rest/v1/app_kv"
    body = json.dumps({'key': key, 'value': value,
                       'updated_at': datetime.utcnow().isoformat() + 'Z'}).encode()
    req = urllib.request.Request(url, data=body, headers={
        **HEADERS, 'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates',
    }, method='POST')
    try:
        urllib.request.urlopen(req, timeout=6, context=_SSL)
    except Exception as e:
        print(f"upsert error: {e}")

# ── helpers ───────────────────────────────────────────────────────────────────
PILL_COLORS = {
    'green': '#22c55e', 'blue': '#3b82f6', 'pink': '#ec4899', 'sky': '#0ea5e9',
    'orange': '#ff6b00', 'yellow': '#ca8a04', 'red': '#ef4444', 'purple': '#a855f7',
    'gray': '#6b7280', 'default': '#374151',
}

def fmt_hour(h):
    def f(n):
        if n in (0, 24): return '12AM'
        if n == 12:      return '12PM'
        return f'{n}AM' if n < 12 else f'{n-12}PM'
    return f'{f(h)}–{f(h+1)}'

POS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.sticky_pos')

def load_pos():
    try:
        with open(POS_FILE) as f:
            d = json.load(f)
            return d['x'], d['y'], d['w'], d['h']
    except Exception:
        return 120, 80, 300, 520

def save_pos(x, y, w, h):
    try:
        with open(POS_FILE, 'w') as f:
            json.dump({'x': x, 'y': y, 'w': w, 'h': h}, f)
    except Exception:
        pass

# ── theme ─────────────────────────────────────────────────────────────────────
BG        = '#111111'
CARD      = '#1c1c1c'
LINE      = '#252525'
INK       = '#f0ede6'
INK2      = '#777777'
ACC       = '#ff6b00'
MONO      = 'Menlo'
SZ        = 9

# ── app ───────────────────────────────────────────────────────────────────────
class StickyApp:
    def __init__(self):
        self.root = tk.Tk()
        self.root.title('Schedule')
        self.root.configure(bg=BG)

        # always on top, visible on every space
        self.root.wm_attributes('-topmost', True)

        x, y, w, h = load_pos()
        self.root.geometry(f'{w}x{h}+{x}+{y}')
        self.root.minsize(240, 200)

        self.schedule = []
        self.goals    = []
        self.active   = 'sched'

        self._build()
        self.root.protocol('WM_DELETE_WINDOW', self._close)
        self._start_refresh()

        # bring to front
        self.root.lift()
        self.root.focus_force()

    # ── UI ────────────────────────────────────────────────────────────────────
    def _build(self):
        r = self.root

        # tab bar
        bar = tk.Frame(r, bg='#0e0e0e', height=36)
        bar.pack(fill=tk.X)
        bar.pack_propagate(False)

        self.btn_s = tk.Button(bar, text='SCHEDULE', bg=CARD, fg=INK,
            font=(MONO, SZ, 'bold'), bd=0, padx=10, pady=5,
            command=self._show_sched, cursor='hand2', relief='flat',
            activebackground=CARD, activeforeground=INK, highlightthickness=0)
        self.btn_s.pack(side=tk.LEFT, padx=(6, 1), pady=4)

        self.btn_g = tk.Button(bar, text='GOALS', bg='#0e0e0e', fg=INK2,
            font=(MONO, SZ, 'bold'), bd=0, padx=10, pady=5,
            command=self._show_goals, cursor='hand2', relief='flat',
            activebackground=CARD, activeforeground=INK, highlightthickness=0)
        self.btn_g.pack(side=tk.LEFT, padx=1, pady=4)

        # refresh on the right
        tk.Button(bar, text='↻', bg='#0e0e0e', fg=INK2,
            font=(MONO, 13), bd=0, padx=6,
            command=self._refresh_click, cursor='hand2', relief='flat',
            activebackground=CARD, activeforeground=INK,
            highlightthickness=0).pack(side=tk.RIGHT, padx=4, pady=4)

        tk.Frame(r, bg=LINE, height=1).pack(fill=tk.X)

        # ── schedule panel ──
        self.sched_panel = tk.Frame(r, bg=BG)

        self.sched_canvas = tk.Canvas(self.sched_panel, bg=BG,
                                      highlightthickness=0, bd=0)
        vsb = tk.Scrollbar(self.sched_panel, orient=tk.VERTICAL,
                            command=self.sched_canvas.yview, width=6)
        self.sched_canvas.configure(yscrollcommand=vsb.set)
        self.sched_canvas.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        vsb.pack(side=tk.RIGHT, fill=tk.Y)

        self.sched_inner = tk.Frame(self.sched_canvas, bg=BG)
        self._sw = self.sched_canvas.create_window((0, 0),
                    window=self.sched_inner, anchor='nw')
        self.sched_inner.bind('<Configure>', lambda e:
            self.sched_canvas.configure(
                scrollregion=self.sched_canvas.bbox('all')))
        self.sched_canvas.bind('<Configure>', lambda e:
            self.sched_canvas.itemconfig(self._sw, width=e.width))
        self.sched_canvas.bind('<MouseWheel>', lambda e:
            self.sched_canvas.yview_scroll(int(-e.delta / 60), 'units'))

        # ── goals panel ──
        self.goals_panel  = tk.Frame(r, bg=BG)
        self.goals_canvas = tk.Canvas(self.goals_panel, bg=BG,
                                      highlightthickness=0, bd=0)
        vsb2 = tk.Scrollbar(self.goals_panel, orient=tk.VERTICAL,
                             command=self.goals_canvas.yview, width=6)
        self.goals_canvas.configure(yscrollcommand=vsb2.set)
        self.goals_canvas.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        vsb2.pack(side=tk.RIGHT, fill=tk.Y)

        self.goals_inner = tk.Frame(self.goals_canvas, bg=BG)
        self._gw = self.goals_canvas.create_window((0, 0),
                    window=self.goals_inner, anchor='nw')
        self.goals_inner.bind('<Configure>', lambda e:
            self.goals_canvas.configure(
                scrollregion=self.goals_canvas.bbox('all')))
        self.goals_canvas.bind('<Configure>', lambda e:
            self.goals_canvas.itemconfig(self._gw, width=e.width))

        # ── footer ──
        self.footer_var = tk.StringVar(value='loading…')
        tk.Frame(r, bg=LINE, height=1).pack(side=tk.BOTTOM, fill=tk.X)
        tk.Label(r, textvariable=self.footer_var, bg='#0e0e0e', fg=INK2,
                 font=(MONO, 8), pady=3).pack(side=tk.BOTTOM, fill=tk.X)

        self._show_sched()

    # ── tabs ──────────────────────────────────────────────────────────────────
    def _show_sched(self):
        self.goals_panel.pack_forget()
        self.sched_panel.pack(fill=tk.BOTH, expand=True)
        self.btn_s.configure(bg=CARD, fg=INK)
        self.btn_g.configure(bg='#0e0e0e', fg=INK2)

    def _show_goals(self):
        self.sched_panel.pack_forget()
        self.goals_panel.pack(fill=tk.BOTH, expand=True)
        self.btn_g.configure(bg=CARD, fg=INK)
        self.btn_s.configure(bg='#0e0e0e', fg=INK2)

    # ── render: schedule ──────────────────────────────────────────────────────
    def _render_sched(self):
        for w in self.sched_inner.winfo_children():
            w.destroy()

        if not self.schedule:
            tk.Label(self.sched_inner,
                     text='No schedule yet.\nAdd slots in the dashboard.',
                     bg=BG, fg=INK2, font=(MONO, SZ),
                     justify=tk.CENTER, pady=28).pack()
            return

        cur_h = datetime.now().hour
        scroll_y = None

        for slot in self.schedule:
            h    = slot.get('hour', 0)
            cur  = (h == cur_h)
            rb   = '#1a0d00' if cur else BG

            row = tk.Frame(self.sched_inner, bg=rb)
            row.pack(fill=tk.X)

            tk.Frame(row, bg=ACC if cur else BG, width=3).pack(
                side=tk.LEFT, fill=tk.Y)

            body = tk.Frame(row, bg=rb, padx=8, pady=5)
            body.pack(side=tk.LEFT, fill=tk.X, expand=True)

            tk.Label(body, text=fmt_hour(h), bg=rb,
                     fg=ACC if cur else INK2,
                     font=(MONO, SZ, 'bold'), anchor='w').pack(anchor='w')

            items = slot.get('items', [])
            if items:
                pf = tk.Frame(body, bg=rb)
                pf.pack(anchor='w', pady=(3, 0))
                for item in items:
                    c = PILL_COLORS.get(item.get('color', 'default'),
                                        PILL_COLORS['default'])
                    tk.Label(pf, text=item.get('label', ''),
                             bg=c, fg='#fff',
                             font=(MONO, SZ - 1, 'bold'),
                             padx=7, pady=1).pack(side=tk.LEFT, padx=(0, 3))

            tk.Frame(self.sched_inner, bg=LINE, height=1).pack(fill=tk.X)

            if cur:
                scroll_y = row

        # scroll current hour into view after layout settles
        if scroll_y:
            def _scroll():
                self.sched_inner.update_idletasks()
                y = scroll_y.winfo_y()
                total = self.sched_inner.winfo_reqheight()
                if total > 0:
                    self.sched_canvas.yview_moveto(
                        max(0.0, (y - 40) / total))
            self.root.after(50, _scroll)

    # ── render: goals ─────────────────────────────────────────────────────────
    def _render_goals(self):
        for w in self.goals_inner.winfo_children():
            w.destroy()

        filled = [g for g in self.goals if g.get('text', '').strip()]
        if not filled:
            tk.Label(self.goals_inner,
                     text='No goals yet.\nAdd them in the dashboard.',
                     bg=BG, fg=INK2, font=(MONO, SZ),
                     justify=tk.CENTER, pady=28).pack()
            return

        for i, goal in enumerate(self.goals):
            if not goal.get('text', '').strip():
                continue
            done = goal.get('done', False)

            row = tk.Frame(self.goals_inner, bg=BG, padx=10, pady=8,
                           cursor='hand2')
            row.pack(fill=tk.X)

            chk = tk.Label(row,
                           text='✓' if done else '  ',
                           bg=ACC if done else '#1e1e1e', fg='#fff',
                           font=(MONO, SZ, 'bold'), width=2, pady=1)
            chk.pack(side=tk.LEFT, padx=(0, 9))

            lbl = tk.Label(row, text=goal['text'], bg=BG,
                           fg='#444' if done else INK,
                           font=(MONO, SZ + 1,
                                 'overstrike' if done else 'normal'),
                           anchor='w', justify=tk.LEFT, wraplength=210)
            lbl.pack(side=tk.LEFT, fill=tk.X, expand=True)

            def _toggle(idx=i):
                self.goals[idx]['done'] = not self.goals[idx].get('done', False)
                threading.Thread(
                    target=lambda: upsert_kv('goals', self.goals),
                    daemon=True).start()
                self._render_goals()

            for widget in (row, chk, lbl):
                widget.bind('<Button-1>', lambda e, f=_toggle: f())
                widget.bind('<Enter>',
                    lambda e, fr=row: fr.configure(bg=CARD))
                widget.bind('<Leave>',
                    lambda e, fr=row: fr.configure(bg=BG))

            tk.Frame(self.goals_inner, bg=LINE, height=1).pack(fill=tk.X)

    # ── data ──────────────────────────────────────────────────────────────────
    def _load_thread(self):
        sched = fetch_kv('schedule')
        goals = fetch_kv('goals')
        self.root.after(0, lambda: self._apply(sched, goals))

    def _apply(self, sched, goals):
        if isinstance(sched, list):
            self.schedule = sched
        if isinstance(goals, list):
            self.goals = goals
        self._render_sched()
        self._render_goals()
        now = datetime.now()
        self.footer_var.set(f'synced {now.hour}:{now.minute:02d}')

    def _refresh_click(self):
        self.footer_var.set('syncing…')
        threading.Thread(target=self._load_thread, daemon=True).start()

    def _start_refresh(self):
        threading.Thread(target=self._load_thread, daemon=True).start()
        self.root.after(30_000, self._start_refresh)

    def _close(self):
        save_pos(self.root.winfo_x(), self.root.winfo_y(),
                 self.root.winfo_width(), self.root.winfo_height())
        self.root.destroy()

    def run(self):
        self.root.mainloop()


if __name__ == '__main__':
    StickyApp().run()
