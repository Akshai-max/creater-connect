' Starts one engine cycle with no console window (the scheduled task "creator-crm engine cycle" runs this).
' A cmd window would sit on screen for the whole cycle, which can take 15 minutes. Output goes to data\engine-cycle.log.
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
sh.Run "cmd /c npm run engine-cycle >> data\engine-cycle.log 2>&1", 0, True
