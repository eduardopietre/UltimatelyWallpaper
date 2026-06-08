Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
pythonw = scriptDir & "\.venv\Scripts\pythonw.exe"
If Not fso.FileExists(pythonw) Then pythonw = "pythonw"
shell.Run """" & pythonw & """ """ & scriptDir & "\run.py""", 0, False
