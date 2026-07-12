' Silent launcher: no console, no PowerShell fallback.
' Double-click or Startup shortcut should target this file via wscript.exe.

Option Explicit

Dim shell, fso, scriptDir, exe, wmi, startup, process, pid, result

Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
exe = scriptDir & "\target\release\sync-service-rs.exe"

If Not fso.FileExists(exe) Then
  ' Do not spawn PowerShell/cmd — that flashes a console.
  WScript.Quit 1
End If

shell.CurrentDirectory = scriptDir

' Win32_Process.Create with ShowWindow=0 avoids the brief console flash
' that WScript.Shell.Run can still produce on some hosts.
Set wmi = GetObject("winmgmts:{impersonationLevel=impersonate}!\\.\root\cimv2")
Set startup = wmi.Get("Win32_ProcessStartup").SpawnInstance_()
startup.ShowWindow = 0

Set process = wmi.Get("Win32_Process")
result = process.Create("""" & exe & """", scriptDir, startup, pid)

If result <> 0 Then
  WScript.Quit result
End If
