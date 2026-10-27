' Lien claudetopia:... (clic sur une notification Windows) : transmet la demande a Claudetopia
' et met sa fenetre au premier plan. Lance par wscript (aucune fenetre ne s'ouvre).
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
If WScript.Arguments.Count = 0 Then WScript.Quit
fichier = sh.ExpandEnvironmentStrings("%USERPROFILE%") & "\.claudetopia-ouvrir"
Set t = fso.CreateTextFile(fichier, True)
t.Write WScript.Arguments(0)
t.Close
sh.AppActivate "Claudetopia"
