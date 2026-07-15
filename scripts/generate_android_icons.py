from pathlib import Path

from PIL import Image, ImageChops, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "public" / "destiny-logo.png"
RES = ROOT / "android" / "app" / "src" / "main" / "res"
BRAND = (68, 74, 128, 255)
MARK = (244, 244, 250, 255)

DENSITIES = {
    "mdpi": (48, 108),
    "hdpi": (72, 162),
    "xhdpi": (96, 216),
    "xxhdpi": (144, 324),
    "xxxhdpi": (192, 432),
}


def extract_mark():
    source = Image.open(SOURCE).convert("RGB")
    background = Image.new("RGB", source.size, source.getpixel((0, 0)))
    difference = ImageChops.difference(source, background)
    alpha = difference.convert("L").point(lambda value: min(255, value * 5))
    # The brand mark occupies the upper portion; excluding the wordmark keeps the
    # launcher icon legible at small sizes.
    alpha = alpha.crop((0, 120, source.width, 455))
    bbox = alpha.getbbox()
    if not bbox:
        raise RuntimeError("Could not locate the Destiny Homes brand mark.")
    alpha = alpha.crop(bbox)
    mark = Image.new("RGBA", alpha.size, MARK)
    mark.putalpha(alpha)
    return mark


def place_mark(canvas, mark, height_ratio):
    target_height = max(1, round(canvas.height * height_ratio))
    target_width = max(1, round(mark.width * target_height / mark.height))
    resized = mark.resize((target_width, target_height), Image.Resampling.LANCZOS)
    position = ((canvas.width - target_width) // 2, (canvas.height - target_height) // 2)
    canvas.alpha_composite(resized, position)


def save_icons():
    mark = extract_mark()
    for density, (legacy_size, foreground_size) in DENSITIES.items():
        output_dir = RES / f"mipmap-{density}"
        output_dir.mkdir(parents=True, exist_ok=True)

        foreground = Image.new("RGBA", (foreground_size, foreground_size), (0, 0, 0, 0))
        place_mark(foreground, mark, 0.54)
        foreground.save(output_dir / "ic_launcher_foreground.png", optimize=True)

        legacy = Image.new("RGBA", (legacy_size, legacy_size), BRAND)
        place_mark(legacy, mark, 0.58)
        legacy.save(output_dir / "ic_launcher.png", optimize=True)

        round_icon = Image.new("RGBA", (legacy_size, legacy_size), (0, 0, 0, 0))
        ImageDraw.Draw(round_icon).ellipse((0, 0, legacy_size - 1, legacy_size - 1), fill=BRAND)
        place_mark(round_icon, mark, 0.54)
        round_icon.save(output_dir / "ic_launcher_round.png", optimize=True)


if __name__ == "__main__":
    save_icons()
