# 生成 README 顶部那张题图（docs/shots/banner.png）。
#
# 用法：powershell -NoProfile -ExecutionPolicy Bypass -File tools/make-banner.ps1
#
# 配色照抄程序自己的主题（src/renderer/styles.css 里那几个变量），别让题图和界面
# 不是一个调子：底色 #14171c，强调色 #d9a441，正文 #e7ecf2，弱化 #96a1b0。
# 棋盘那点纹理用程序里深色木纹的下半段（#c99a5e 到 #a97c46）压得很淡。
# 字体用 Noto Serif SC（标题，衬线的更像棋谱）与 Microsoft YaHei UI（正文）。
#
# 这个文件带 UTF-8 BOM，别存成不带 BOM 的 UTF-8：Windows PowerShell 5.1 会按 ANSI 读，
# 下面那些中文变成乱码，报的是「字符串缺少终止符」，看着像引号写错了。

Add-Type -AssemblyName System.Drawing

$W = 1760
$H = 560
$out = Join-Path $PSScriptRoot '..\docs\shots\banner.png'

function New-Rgba([int]$a, [int]$r, [int]$g, [int]$b) {
  [System.Drawing.Color]::FromArgb($a, $r, $g, $b)
}

# 一层层往外画椭圆做柔光：PathGradientBrush 的周围色数量要对得上路径点数，不折腾它
function Add-Glow($g, [double]$cx, [double]$cy, [double]$rx, [double]$ry, $color, [int]$maxAlpha, [int]$steps) {
  for ($i = $steps; $i -ge 1; $i--) {
    $k = $i / $steps
    $a = [int]($maxAlpha * (1 - $k) * (1 - $k))
    if ($a -le 0) { continue }
    $brush = New-Object System.Drawing.SolidBrush (New-Rgba $a $color.R $color.G $color.B)
    $g.FillEllipse($brush, [float]($cx - $rx * $k), [float]($cy - $ry * $k), [float](2 * $rx * $k), [float](2 * $ry * $k))
    $brush.Dispose()
  }
}

function New-Font($family, [double]$size, $style) {
  $f = New-Object System.Drawing.Font($family, $size, $style, [System.Drawing.GraphicsUnit]::Pixel)
  if ($f.Name -ne $family) { throw "字体没找到：$family（拿到的是 $($f.Name)）" }
  return $f
}

$bmp = New-Object System.Drawing.Bitmap($W, $H)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic

# 底：从左上到右下的一点点渐变，别是死板的纯色
$rect = New-Object System.Drawing.Rectangle(0, 0, $W, $H)
$bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, (New-Rgba 255 20 23 28), (New-Rgba 255 27 34 43), 25.0)
$g.FillRectangle($bg, $rect)

# 右上角一团暖暖的光，右下角一片冷光，画面就不平了
$accent = New-Rgba 255 217 164 65
Add-Glow $g ($W * 0.86) ($H * 0.18) 620 460 $accent 46 26
Add-Glow $g ($W * 0.12) ($H * 1.05) 700 420 (New-Rgba 255 90 130 170) 34 26

# 棋盘纹理：木色格线压得很淡，左边淡到看不见（用渐变画笔当线条的笔，让线自己渐隐）
$wood1 = New-Rgba 54 201 154 94
$wood2 = New-Rgba 0 169 124 70
$step = 80
$left = 470
for ($x = $left; $x -le $W; $x += $step) {
  $gb = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.PointF($left, 0)),
    (New-Object System.Drawing.PointF($W, 0)),
    $wood2, $wood1)
  $pen = New-Object System.Drawing.Pen($gb, 2)
  $g.DrawLine($pen, $x, 0, $x, $H)
  $pen.Dispose(); $gb.Dispose()
}
$penH = New-Object System.Drawing.Pen (New-Rgba 40 201 154 94), 2
for ($y = 40; $y -le $H; $y += $step) { $g.DrawLine($penH, $left, $y, $W, $y) }
$penH.Dispose()

# 几颗子：白的偏暖、黑的留一道边，半透明当装饰。
# 只落在右边那半边的格点上：中间那几列正好在标题底下，子压在字上看着像一团光斑。
function Add-Stone($g, [double]$cx, [double]$cy, [double]$r, [bool]$white, [int]$alpha) {
  # 深色底上不能照搬木盘上那套画法：黑子几乎和底色一样暗，白子也压不住。
  # 反过来用外圈定形，黑子外面套一圈暖边（就是主题的强调色），白子外面套一道暗边。
  if ($white) {
    $rim = New-Rgba ([int]($alpha * 0.8)) 22 26 32
    $body = New-Rgba $alpha 246 240 228
    $hlA = [int]($alpha * 0.85); $hlR = 0.44; $hlG = 0.36
  } else {
    $rim = New-Rgba ([int]($alpha * 0.62)) 217 164 65
    $body = New-Rgba $alpha 13 16 21
    $hlA = [int]($alpha * 0.3); $hlR = 0.4; $hlG = 0.32
  }
  $b = New-Object System.Drawing.SolidBrush $rim
  $g.FillEllipse($b, [float]($cx - $r), [float]($cy - $r), [float](2 * $r), [float](2 * $r))
  $b.Dispose()
  $b = New-Object System.Drawing.SolidBrush $body
  $g.FillEllipse($b, [float]($cx - $r * 0.88), [float]($cy - $r * 0.88), [float](1.76 * $r), [float](1.76 * $r))
  $b.Dispose()
  # 高光：白子是球面反光，黑子上就一点点，不然像塑料
  $hl = New-Object System.Drawing.SolidBrush (New-Rgba $hlA 255 250 242)
  $g.FillEllipse($hl, [float]($cx - $r * 0.46), [float]($cy - $r * 0.56), [float]($r * $hlR), [float]($r * $hlG))
  $hl.Dispose()
}
# 摆成一道梯子（黑一白一地往上爬），比随手撒几颗看着有章法。
# 列号从 11 起，也就是 x 从 1350 开始：再往左就压到「神之一手」那几个字上了。
$stones = @(
  @{ c = 11; r = 4; w = $false; a = 232; s = 33 },
  @{ c = 12; r = 3; w = $true;  a = 226; s = 33 },
  @{ c = 13; r = 4; w = $false; a = 214; s = 33 },
  @{ c = 14; r = 3; w = $true;  a = 200; s = 33 },
  @{ c = 15; r = 4; w = $false; a = 168; s = 33 },
  @{ c = 16; r = 3; w = $true;  a = 150; s = 33 },
  @{ c = 15; r = 1; w = $false; a = 118; s = 32 },
  @{ c = 16; r = 1; w = $true;  a = 100; s = 32 }
)
foreach ($s in $stones) {
  Add-Stone $g (470 + $s.c * 80) (40 + $s.r * 80) $s.s $s.w $s.a
}

# 四角压暗一圈，中间留亮，视线自然会落在字上
$vign = New-Object System.Drawing.Drawing2D.GraphicsPath
$vign.AddEllipse(-260, -300, $W + 520, $H + 600)
$vg = New-Object System.Drawing.Drawing2D.PathGradientBrush($vign)
$vg.CenterColor = (New-Rgba 0 8 10 13)
$vg.SurroundColors = @((New-Rgba 210 8 10 13))
$g.FillPath($vg, $vign)
$vg.Dispose(); $vign.Dispose()

# 字：先一层淡淡的重影当阴影，再压正文
$fmt = New-Object System.Drawing.StringFormat
$fmt.Alignment = [System.Drawing.StringAlignment]::Center
$fmt.LineAlignment = [System.Drawing.StringAlignment]::Center

# 大写字母那行手工排开字距：DrawString 没有字距这一项，逐字画、自己定前进量
$trackFont = New-Font 'Georgia' 20 ([System.Drawing.FontStyle]::Regular)
$track = 'SHEN ZHI YI SHOU'
$adv = 19.0
$charFmt = New-Object System.Drawing.StringFormat
$charFmt.Alignment = [System.Drawing.StringAlignment]::Near
$charFmt.LineAlignment = [System.Drawing.StringAlignment]::Center
$trackBrush = New-Object System.Drawing.SolidBrush (New-Rgba 170 206 196 178)
$trackX = ($W - ($track.Length - 1) * $adv) / 2
for ($i = 0; $i -lt $track.Length; $i++) {
  $ch = $track.Substring($i, 1)
  if ($ch -eq ' ') { continue }
  $g.DrawString($ch, $trackFont, $trackBrush,
    (New-Object System.Drawing.RectangleF([float]($trackX + $i * $adv), [float]116, [float]$adv, [float]40)), $charFmt)
}
$trackBrush.Dispose(); $charFmt.Dispose(); $trackFont.Dispose()

$titleFont = New-Font 'Noto Serif SC' 138 ([System.Drawing.FontStyle]::Bold)
$titleRect = New-Object System.Drawing.RectangleF(0, 158, $W, 180)
$shadow = New-Object System.Drawing.SolidBrush (New-Rgba 130 0 0 0)
$g.DrawString('神之一手', $titleFont, $shadow, (New-Object System.Drawing.RectangleF(3, 164, $W, 180)), $fmt)
$titleBrush = New-Object System.Drawing.SolidBrush (New-Rgba 255 242 232 213)
$g.DrawString('神之一手', $titleFont, $titleBrush, $titleRect, $fmt)
$titleBrush.Dispose(); $shadow.Dispose(); $titleFont.Dispose()

# 一道强调色的短线，把标题和说明分开
$lineW = 168; $lineH = 5
$line = New-Object System.Drawing.SolidBrush $accent
$g.FillRectangle($line, [float](($W - $lineW) / 2), [float]347, $lineW, $lineH)
$line.Dispose()
Add-Glow $g ($W / 2) 350 220 40 $accent 70 18

$subFont = New-Font 'Microsoft YaHei UI' 33 ([System.Drawing.FontStyle]::Regular)
$subBrush = New-Object System.Drawing.SolidBrush (New-Rgba 255 156 176 192)
$g.DrawString('KataGo v1.18.1 · 本地棋盘识别 · 网页与客户端双向同步 · 完整 SGF', $subFont, $subBrush,
  (New-Object System.Drawing.RectangleF(0, 394, $W, 60)), $fmt)
$subBrush.Dispose(); $subFont.Dispose()

$g.Dispose()
$dir = Split-Path $out -Parent
if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Output ("题图已生成：" + (Resolve-Path $out).Path)
