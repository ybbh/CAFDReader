"""Negative build-admission checks using the independent, already-built fixture."""
import argparse, json, os, subprocess, tempfile
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--caf-tool', default=os.environ.get('CAF_TOOL'))
args = parser.parse_args()
if not args.caf_tool:
    parser.error('Set CAF_TOOL or pass --caf-tool')
tool = str(Path(args.caf_tool).resolve())
fixture = ROOT / 'tests/llm-fixture'
config = (fixture / 'build.toml').read_text().split('[components.build]')[0]
config = config.replace('"../../spec/llm.wit"', json.dumps(str(ROOT / 'spec/llm.wit')))
config = config.replace('"fixture.wit"', json.dumps(str(fixture / 'fixture.wit')))
config = config.replace('root = "payload"', 'root = ' + json.dumps(str(fixture / 'payload')))
config = config.replace('path = "../../build/llm-fixture.wasm"', 'path = ' + json.dumps(str(ROOT / 'build/llm-fixture.wasm')))
if not (ROOT / 'build/llm-fixture.wasm').exists():
    parser.error('Build the LLM fixture first')
with tempfile.TemporaryDirectory(prefix='cafd-llm-admission-') as directory:
    base = Path(directory)
    for name, content, expected in [
        ('undeclared', config.replace('llm = "caf:llm@1"', ''), 'undeclared or unsupported LLM import'),
        ('future', config.replace('caf:llm@1', 'caf:llm@2'), 'LLM requires'),
        ('deterministic', config.replace('caf-x1', 'caf-d1').replace('deterministic = false', 'deterministic = true'), 'LLM requires'),
    ]:
        path = base / (name + '.toml')
        path.write_text(content)
        output = base / (name + '.cafd')
        result = subprocess.run([tool, 'build', '-c', str(path), '-o', str(output)], capture_output=True, text=True)
        assert result.returncode != 0, name
        assert expected in result.stderr, (name, result.stderr)
        assert not output.exists(), name
        print('PASS rejected', name)
