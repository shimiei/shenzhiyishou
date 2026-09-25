# Drives a real OS-level mouse drag so we can verify dragging the splitter
# across the embedded webview keeps tracking. Synthetic DOM events cannot prove
# this: the whole point is that a real pointer over a webview is swallowed by
# the guest renderer unless a shield covers it.
# Usage: probe-mouse-drag.ps1 -Hwnd <handle> -X0 -Y0 -X1 -Y1 [-HoldMs -Steps -ClickOnly]
param(
  [long]$Hwnd = 0,
  [int]$X0, [int]$Y0, [int]$X1, [int]$Y1,
  [int]$HoldMs = 800, [int]$Steps = 20,
  [switch]$ClickOnly
)
Add-Type -Namespace Drg -Name M -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
[DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, int e);
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
'@
if ($Hwnd -ne 0) {
  [Drg.M]::SetForegroundWindow([IntPtr]$Hwnd) | Out-Null
  Start-Sleep -Milliseconds 400
  Write-Output ("foreground now " + [Drg.M]::GetForegroundWindow().ToInt64())
}
Start-Sleep -Milliseconds 250
[Drg.M]::SetCursorPos($X0, $Y0)
Start-Sleep -Milliseconds 150
if ($ClickOnly) {
  [Drg.M]::mouse_event(0x0002, 0, 0, 0, 0)
  Start-Sleep -Milliseconds 60
  [Drg.M]::mouse_event(0x0004, 0, 0, 0, 0)
  Write-Output "click at $X0,$Y0"
  exit 0
}
[Drg.M]::mouse_event(0x0002, 0, 0, 0, 0)   # left down
for ($i = 1; $i -le $Steps; $i++) {
  $x = [int]($X0 + ($X1 - $X0) * $i / $Steps)
  $y = [int]($Y0 + ($Y1 - $Y0) * $i / $Steps)
  [Drg.M]::SetCursorPos($x, $y)
  Start-Sleep -Milliseconds 35
}
Start-Sleep -Milliseconds $HoldMs
[Drg.M]::mouse_event(0x0004, 0, 0, 0, 0)   # left up
Write-Output "drag done $X0,$Y0 -> $X1,$Y1"
