# Sends real keystrokes to the app window (SendKeys goes through the OS,
# which is the only way to exercise Electron menu accelerators and
# before-input-event; CDP-injected keys bypass that pipeline entirely).
# Usage: probe-keys.ps1 -Hwnd <handle> -ClickX -ClickY -Keys "^t"
param([long]$Hwnd = 0, [int]$ClickX = -1, [int]$ClickY = -1, [string]$Keys = '')
Add-Type -AssemblyName System.Windows.Forms
Add-Type -Namespace K -Name W -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
[DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, int e);
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
'@
if ($Hwnd -ne 0) {
  [K.W]::SetForegroundWindow([IntPtr]$Hwnd) | Out-Null
  Start-Sleep -Milliseconds 500
}
Write-Output ("foreground=" + [K.W]::GetForegroundWindow().ToInt64())
if ($ClickX -ge 0) {
  [K.W]::SetCursorPos($ClickX, $ClickY)
  Start-Sleep -Milliseconds 200
  [K.W]::mouse_event(0x0002, 0, 0, 0, 0)
  Start-Sleep -Milliseconds 60
  [K.W]::mouse_event(0x0004, 0, 0, 0, 0)
  Start-Sleep -Milliseconds 400
  Write-Output "clicked $ClickX,$ClickY"
}
if ($Keys -ne '') {
  [System.Windows.Forms.SendKeys]::SendWait($Keys)
  Start-Sleep -Milliseconds 700
  Write-Output ("sent " + $Keys)
}
