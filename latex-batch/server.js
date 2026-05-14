const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3737;
const OUTPUT_DIR = path.join(__dirname, 'output');

function makeLatex(job) {
  const { company, title, tag } = job;
  const safe = s => (s || '').replace(/[&%$#_{}~^\\]/g, '\\$&');
  return `\\documentclass[letterpaper,11pt]{article}

\\usepackage{latexsym}
\\usepackage[empty]{fullpage}
\\usepackage{titlesec}
\\usepackage{marvosym}
\\usepackage[usenames,dvipsnames]{color}
\\usepackage{verbatim}
\\usepackage{enumitem}
\\usepackage[hidelinks]{hyperref}
\\usepackage{fancyhdr}
\\usepackage[english]{babel}
\\usepackage{tabularx}
\\usepackage{fontawesome5}
\\usepackage{multicol}
\\setlength{\\multicolsep}{-3.0pt}
\\setlength{\\columnsep}{-1pt}
\\input{glyphtounicode}

\\pagestyle{fancy}
\\fancyhf{}
\\fancyfoot{}
\\renewcommand{\\headrulewidth}{0pt}
\\renewcommand{\\footrulewidth}{0pt}

% Adjust margins
\\addtolength{\\oddsidemargin}{-0.6in}
\\addtolength{\\evensidemargin}{-0.5in}
\\addtolength{\\textwidth}{1.19in}
\\addtolength{\\topmargin}{-.7in}
\\addtolength{\\textheight}{1.4in}

\\urlstyle{same}

\\raggedbottom
\\raggedright
\\setlength{\\tabcolsep}{0in}

% Sections formatting
\\titleformat{\\section}{
  \\vspace{-4pt}\\scshape\\raggedright\\large\\bfseries
}{}{0em}{}[\\color{black}\\titlerule \\vspace{-5pt}]

% Ensure that generate pdf is machine readable/ATS parsable
\\pdfgentounicode=1

%-------------------------
% Custom commands
\\newcommand{\\resumeItem}[1]{
  \\item\\small{
    {#1 \\vspace{-2pt}}
  }
}

\\newcommand{\\classesList}[4]{
    \\item\\small{
        {#1 #2 #3 #4 \\vspace{-2pt}}
  }
}

\\newcommand{\\resumeSubheading}[4]{
  \\vspace{-2pt}\\item
    \\begin{tabular*}{1.0\\textwidth}[t]{l@{\\extracolsep{\\fill}}r}
      \\textbf{#1} & \\textbf{\\small #2} \\\\
      \\textit{\\small#3} & \\textit{\\small #4} \\\\
    \\end{tabular*}\\vspace{-7pt}
}

\\newcommand{\\resumeSubSubheading}[2]{
    \\item
    \\begin{tabular*}{0.97\\textwidth}{l@{\\extracolsep{\\fill}}r}
      \\textit{\\small#1} & \\textit{\\small #2} \\\\
    \\end{tabular*}\\vspace{-7pt}
}

\\newcommand{\\resumeProjectHeading}[2]{
    \\item
    \\begin{tabular*}{1.001\\textwidth}{l@{\\extracolsep{\\fill}}r}
      \\small#1 & \\textbf{\\small #2}\\\\
    \\end{tabular*}\\vspace{-7pt}
}

\\newcommand{\\resumeSubItem}[1]{\\resumeItem{#1}\\vspace{-4pt}}

\\renewcommand\\labelitemi{$\\vcenter{\\hbox{\\tiny$\\bullet$}}$}
\\renewcommand\\labelitemii{$\\vcenter{\\hbox{\\tiny$\\bullet$}}$}

\\newcommand{\\resumeSubHeadingListStart}{\\begin{itemize}[leftmargin=0.0in, label={}]}
\\newcommand{\\resumeSubHeadingListEnd}{\\end{itemize}}
\\newcommand{\\resumeItemListStart}{\\begin{itemize}}
\\newcommand{\\resumeItemListEnd}{\\end{itemize}\\vspace{-5pt}}

\\begin{document}



\\begin{center}

{\\Huge \\scshape Rakshanda Bhure} \\\\ \\vspace{2pt}

\\small Seattle, WA $|$ (206)-513-6518 $|$
\\href{mailto:rakkshanda.b@gmail.com}{rakkshanda.b@gmail.com} $|$
\\href{https://linkedin.com/in/rakkshanda}{linkedin.com/in/rakkshanda} $|$
\\href{https://www.rakkshanda.com}{www.rakkshanda.com}

\\vspace{-6pt}

\\end{center}




\\end{document}
`;
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.method === 'POST' && req.url === '/create-latex') {
    let body = '';
    req.on('data', d => { body += d; });
    req.on('end', () => {
      try {
        const { jobs } = JSON.parse(body);
        if (!Array.isArray(jobs) || !jobs.length) throw new Error('No jobs provided');

        const MONTHS = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
        const now = new Date();
        const dayFolder = `${MONTHS[now.getMonth()]}${now.getDate()}`;
        const dayDir = path.join(OUTPUT_DIR, dayFolder);

        const slug = s => (s || '').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase();
        const tagsUsed = new Set();

        jobs.forEach(job => {
          const tag = (job.tag || 'misc').toLowerCase();
          const tagDir = path.join(dayDir, tag);
          fs.mkdirSync(tagDir, { recursive: true });
          tagsUsed.add(tag);
          const name = `${slug(job.company) || 'job'}_${slug(job.title) || 'untitled'}.tex`;
          fs.writeFileSync(path.join(tagDir, name), makeLatex(job));
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          count: jobs.length,
          outputDir: dayDir,
          folders: [...tagsUsed].map(t => `${dayFolder}/${t}`),
        }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(PORT, () => {
  console.log(`LaTeX server on http://localhost:${PORT}`);
  console.log(`Files saved to: ${OUTPUT_DIR}`);
});
