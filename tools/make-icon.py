"""生成插件图标 icon.png（160x160）。

思源要求图标为 PNG（不支持 SVG），建议尺寸 160x160、体积小于 64 KiB。
这里画一个简洁的计算器图标：深色机身 + 显示屏 + 按键网格 + 等号高亮。
"""

from PIL import Image, ImageDraw

SIZE = 160
SCALE = 4  # 超采样后缩小，得到平滑边缘
W = SIZE * SCALE

# 配色
BODY = (47, 54, 64)
BODY_EDGE = (32, 38, 46)
SCREEN = (226, 240, 253)
SCREEN_TEXT = (37, 99, 235)
KEY = (148, 163, 184)
KEY_ACCENT = (59, 130, 246)

img = Image.new("RGBA", (W, W), (0, 0, 0, 0))
draw = ImageDraw.Draw(img)


def rect(box, radius, fill, outline=None, width=0):
    draw.rounded_rectangle(
        [int(v * SCALE) for v in box],
        radius=int(radius * SCALE),
        fill=fill,
        outline=outline,
        width=int(width * SCALE),
    )


# 机身
rect((16, 12, 144, 148), 20, BODY, BODY_EDGE, 3)

# 显示屏
rect((32, 28, 128, 66), 8, SCREEN)

# 屏幕上的「=」提示
bar_w = 26
draw.rounded_rectangle(
    [int(48 * SCALE), int(42 * SCALE), int((48 + bar_w) * SCALE), int(47 * SCALE)],
    radius=int(2.5 * SCALE), fill=SCREEN_TEXT,
)
draw.rounded_rectangle(
    [int(48 * SCALE), int(52 * SCALE), int((48 + bar_w) * SCALE), int(57 * SCALE)],
    radius=int(2.5 * SCALE), fill=SCREEN_TEXT,
)

# 按键：3 列 3 行，最后一列高亮
cols = [34, 68, 102]
rows = [80, 104, 128]
for row_index, y in enumerate(rows):
    for col_index, x in enumerate(cols):
        accent = col_index == 2 and row_index == 2
        rect((x, y, x + 24, y + 14), 4, KEY_ACCENT if accent else KEY)

img = img.resize((SIZE, SIZE), Image.LANCZOS)
img.save("icon.png", "PNG", optimize=True)
print("已生成 icon.png")
