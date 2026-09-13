#!/usr/bin/env python3
"""Real PTY Reply journey; stdlib avoids a Node PTY dependency."""
import errno
import json
import os
from pathlib import Path
import pty
import select
import shlex
import shutil
import subprocess
import tempfile
import time

writer = Path(__file__).resolve().with_name('notebook-write.js')
root = Path(tempfile.mkdtemp(prefix='agf-reply-pty-'))
subprocess.run([shutil.which('node'), '-e', "const fs=require('node:fs'),s=require(process.argv[1]);const c=s.make_template('codex');c.switches['target-doc']='devlog.md';fs.writeFileSync(process.argv[2],JSON.stringify(c));", str(writer.with_name('ag-settings.js')), str(root / 'ag.json')], check=True)
session = '01a0927f-421d-7263-ab12-083e0839d8ac'
home = root / 'runtime'
(home / 'sessions/2026/09/12').mkdir(parents=True)
transcript = home / f'sessions/2026/09/12/rollout-current-{session}.jsonl'
meta = {'type': 'session_meta', 'payload': {'id': session, 'cwd': str(root)}}
def turn(model, effort):
    return {'type': 'turn_context', 'payload': {'cwd': str(root), 'model': model, 'effort': effort}}
transcript.write_text(json.dumps(meta) + '\n' + json.dumps(turn('model-one', 'low')) + '\n')
(home / 'config.toml').write_text('model = "wrong-default"\n')
(root / 'devlog.md').write_text('# STATUS\n\nProject: PTY fixture\n\n---\n\n# → Ask / A-001\n\n+ Record this fixture.\n\n+ skip-review: disposable fixture\n')
(root / 'reply.md').write_text('# ← Reply / A-001\n\n* _2026-09-12 00:00:00 +0800 (host)_\n\n## [SUMMARY]\n\n- Done.\n\n## [FINAL REPORT]\n\n1. Recorded fixture.\n\n```completion-metadata\nHost review: PASS — inspected disposable fixture.\n```\n')
(root / 'next-turn.jsonl').write_text(json.dumps(turn('model-two', 'high')) + '\n')
(root / 'next.js').write_text("const fs=require('node:fs');const w=require(" + json.dumps(str(writer)) + ");w.append_input({notebook:'devlog.md',text:'Record second fixture.\\n\\nskip-review: disposable fixture'});fs.appendFileSync(" + json.dumps(str(transcript)) + ",fs.readFileSync('next-turn.jsonl'));fs.writeFileSync('reply.md',fs.readFileSync('reply.md','utf8').replace('A-001','A-002'));\n")
pid, fd = pty.fork()
if pid == 0:
    os.chdir(root)
    os.environ.update(CODEX_HOME=str(home), CODEX_THREAD_ID=session, CODEX_SESSION_ID=session, TERM='xterm-256color', HISTFILE='/dev/null')
    os.execl('/bin/sh', 'sh', '-i')
node = shlex.quote(shutil.which('node'))
command = f'{node} {shlex.quote(str(writer))} append-reply --notebook devlog.md --ask '
script = f'test -t 0 && test -t 1 && echo PTY_OK\n{command}A-001 --input-stdin < reply.md\n{node} next.js\n{command}A-002 --input-stdin < reply.md\nresult=$?\ncat devlog.md\necho JOURNEY_EXIT:$result\nexit "$result"\n'
os.write(fd, script.encode())
output = bytearray()
deadline = time.monotonic() + 20
while time.monotonic() < deadline:
    if not select.select([fd], [], [], 0.2)[0]:
        continue
    try:
        chunk = os.read(fd, 65536)
    except OSError as error:
        if error.errno == errno.EIO:
            break
        raise
    if not chunk:
        break
    output.extend(chunk)
else:
    os.kill(pid, 9)
    raise AssertionError('PTY journey timed out')
_, status = os.waitpid(pid, 0)
os.close(fd)
text = output.decode(errors='replace').replace('\r', '')
assert os.waitstatus_to_exitcode(status) == 0, text
assert 'PTY_OK\n' in text and 'JOURNEY_EXIT:0\n' in text, text
assert 'append-reply --notebook' in text and 'devlog.md updated' in text, text
saved = (root / 'devlog.md').read_text()
assert '(model-one/low)_' in saved and '(model-two/high)_' in saved, text
assert '(model-one/low)_' in text and '(model-two/high)_' in text, text
assert saved.count('# ← Reply /') == 2 and '# → Ask / A-003' in saved, text
assert 'wrong-default' not in saved and '(host)_' not in saved
print('PASS: PTY identity, visible input/output, exit 0, two transcript-attributed Replies after a model switch, next Ask and prior stamp preserved')
