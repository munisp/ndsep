from pathlib import Path
from PIL import Image

ROOT = Path('/home/ubuntu/idlr_pts_mobile/assets/images')
TARGETS = [
    'icon.png',
    'splash-icon.png',
    'favicon.png',
    'android-icon-foreground.png',
]

for name in TARGETS:
    path = ROOT / name
    image = Image.open(path).convert('RGBA')
    image = image.resize((1024, 1024), Image.LANCZOS)
    image.save(path, format='PNG', optimize=True)
    print(f'optimized {name}: {path.stat().st_size}')
