"""Build and verify the independent LLM fixture. Requires the updated CAF_TOOL."""
import argparse, hashlib, os, shutil, subprocess, sys
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--caf-tool', default=os.environ.get('CAF_TOOL') or shutil.which('caf-tool'))
    args = parser.parse_args()
    if not args.caf_tool:
        parser.error('Set CAF_TOOL or pass --caf-tool to the updated caf-tool binary')
    tool = str(Path(args.caf_tool).resolve())
    output = ROOT / 'build/llm-fixture.cafd'
    output.parent.mkdir(exist_ok=True)
    config = ROOT / 'tests/llm-fixture/build.toml'
    for iteration in range(2):
        subprocess.run([tool, 'build', '-c', str(config), '-o', str(output)], check=True)
        subprocess.run([tool, 'verify', str(output)], check=True)
        digest = hashlib.sha256(output.read_bytes()).hexdigest()
        if iteration == 0:
            baseline = digest
        elif baseline != digest:
            raise RuntimeError('Fixture build is not reproducible')
    subprocess.run([sys.executable, str(ROOT / 'tests/llm-build.spec.py'), '--caf-tool', tool], check=True)
    print(f'PASS reproducible LLM fixture: {output}\nSHA-256 {digest}')

if __name__ == '__main__':
    main()
