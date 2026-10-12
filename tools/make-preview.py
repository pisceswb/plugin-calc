"""生成集市预览图 preview.png（1024x768）。

思源集市要求：预览图必须是包根的普通图片文件，支持 PNG/JPEG/WebP/AVIF，
建议 1024*768、体积不超过 512 KiB。
这里画一张简洁的功能预览：标题 + 示例算式 + 计算结果。
"""

from PIL import Image, ImageDraw, ImageFont

WIDTH, HEIGHT = 1024, 768
SCALE = 2  # 超采样后缩小，边缘更平滑

BG = (247, 249, 252)
CARD = (255, 255, 255)
TITLE = (23, 37, 84)
TEXT = (51, 65, 85)
MUTED = (100, 116, 139)
ACCENT = (37, 99, 235)
RESULT = (22, 163, 74)
BORDER = (219, 228, 240)

img = Image.new("RGB", (WIDTH * SCALE, HEIGHT * SCALE), BG)
draw = ImageDraw.Draw(img)


def font(size, bold=False):
    """尽量找一个可用的中文字体，找不到就退回默认字体。"""
    candidates = [
        r"C:\Windows\Fonts\msyhbd.ttc" if bold else r"C:\Windows\Fonts\msyh.ttc",
        r"C:\Windows\Fonts\simhei.ttf",
        r"C:\Windows\Fonts\simsun.ttc",
        r"C:\Windows\Fonts\arialbd.ttf" if bold else r"C:\Windows\Fonts\arial.ttf",
    ]
    for path in candidates:
        try:
            return ImageFont.truetype(path, size * SCALE)
        except OSError:
            continue
    return ImageFont.load_default()


def rrect(box, radius, fill, outline=None, width=0):
    draw.rounded_rectangle(
        [int(v * SCALE) for v in box],
        radius=int(radius * SCALE),
        fill=fill,
        outline=outline,
        width=int(width * SCALE),
    )


# 顶部标题区
rrect((0, 0, WIDTH, 168), 0, (239, 246, 255))
draw.text((64 * SCALE, 48 * SCALE), "等号计算  Equals Calc", font=font(46, True), fill=TITLE)
draw.text((64 * SCALE, 112 * SCALE), "输入算式后按回车，结果自动补在等号后面",
          font=font(24), fill=MUTED)

# 主体卡片：示例
rrect((64, 208, WIDTH - 64, HEIGHT - 64), 20, CARD, BORDER, 2)

rows = [
    ("12*5=", "12*5=60"),
    ("测试12*5=", "测试12*5=60"),
    ("12×5=60*3=", "12×5=60*3=180"),
]
y = 264
for left, right in rows:
    draw.text((112 * SCALE, y * SCALE), left, font=font(30), fill=TEXT)
    # 结果部分用绿色强调
    draw.text((430 * SCALE, y * SCALE), right, font=font(30, True), fill=RESULT)
    y += 62

# 分隔线
draw.line([(112 * SCALE, (y + 12) * SCALE), ((WIDTH - 112) * SCALE, (y + 12) * SCALE)],
          fill=BORDER, width=2 * SCALE)

# 方程示例
y += 44
draw.text((112 * SCALE, y * SCALE), "一元方程：", font=font(26, True), fill=ACCENT)
y += 46
for left, right in [("x+3=5=", "x+3=5=2"), ("x^2=4=", "x^2=4=-2 或 2")]:
    draw.text((140 * SCALE, y * SCALE), left, font=font(28), fill=TEXT)
    draw.text((430 * SCALE, y * SCALE), right, font=font(28, True), fill=RESULT)
    y += 56

# 底部说明
draw.text((112 * SCALE, (HEIGHT - 108) * SCALE),
          "无需 eval 的十进制高精度运算 · 0.1+0.2= 得到干净的 0.3", font=font(22), fill=MUTED)

img = img.resize((WIDTH, HEIGHT), Image.LANCZOS)
img.save("preview.png", "PNG", optimize=True)
print("已生成 preview.png")
