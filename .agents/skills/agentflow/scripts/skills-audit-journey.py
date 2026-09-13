#!/usr/bin/env python3
"""Real PTY journey for the read-only skills audit (stdlib; no node PTY dependency)."""
import errno
import fcntl
import os
from pathlib import Path
import pty
import select
import shlex
import shutil
import struct
import tempfile
import termios
import time

cli = Path(__file__).resolve().with_name('agf.js')
root = Path(tempfile.mkdtemp(prefix='agf-audit-pty-'))
(root / '.agents/skills/example').mkdir(parents=True)
(root / '.agents/skills/example/SKILL.md').write_text('Example skill; audit must not execute it.\n')
(root / 'home').mkdir()
before = sorted((str(p.relative_to(root)), p.read_bytes()) for p in root.rglob('*') if p.is_file())
pid, fd = pty.fork()
if pid == 0:
    os.chdir(root)
    os.environ.update(HOME=str(root / 'home'), CODEX_HOME=str(root / 'home/.codex'), CLAUDE_CONFIG_DIR=str(root / 'home/.claude'), TERM='xterm-256color', HISTFILE='/dev/null')
    os.execl('/bin/sh', 'sh', '-i')
fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', 24, 80, 0, 0))
command = f'test -t 0 && test -t 1 && echo PTY_OK; {shlex.quote(shutil.which("node"))} {shlex.quote(str(cli))} skills audit; result=$?; echo AUDIT_EXIT:$result; exit "$result"\n'
os.write(fd, command.encode())
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
assert '\nPTY_OK\n' in text, text
assert 'skills audit;' in text, 'Input was not visibly echoed'
assert 'Skills audit: inventory ready; conflict assessment not performed.' in text
assert 'SKILL.md' in text and 'Read-only audit prompt' in text
assert '\nAUDIT_EXIT:0\n' in text
body = text.split('\nPTY_OK\n', 1)[1].split('\nAUDIT_EXIT:0', 1)[0]
assert all(len(line) <= 80 for line in body.splitlines()), 'Output exceeds terminal width'
after = sorted((str(p.relative_to(root)), p.read_bytes()) for p in root.rglob('*') if p.is_file())
assert before == after, 'Audit changed fixture files'
print('PASS: real PTY identity, visible input/output, 80-column wrapping, exit 0, unchanged files')
