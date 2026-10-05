"""Build a static demo from web sources and the canonical engine model."""
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parent.parent
output = ROOT / 'dist'
output.mkdir(exist_ok=True)
for path in (ROOT / 'web').iterdir():
    if path.is_file():
        shutil.copy2(path, output / path.name)
shutil.copy2(ROOT / 'altertale/data/jingzhou.json', output / 'jingzhou.json')
print(f'Built {output}')
