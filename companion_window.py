"""Explicitly launch the trusted local window, with actionable startup failures."""
import argparse
import os
from pathlib import Path
import subprocess


def launch(workspace):
    if os.name!='nt':raise ValueError('The local approval window is Windows-only; use companion_local.py')
    workspace=Path(workspace).resolve();workspace.mkdir(parents=True,exist_ok=True)
    script=Path(__file__).resolve().parent/'companion_control.ps1'
    logfile=workspace/'companion-approvals.log'
    with logfile.open('ab') as log:
        process=subprocess.Popen(['powershell.exe','-NoProfile','-STA','-WindowStyle','Hidden','-File',str(script),'-Workspace',str(workspace)],stdin=subprocess.DEVNULL,stdout=log,stderr=log,creationflags=subprocess.CREATE_NO_WINDOW)
    try:
        code=process.wait(timeout=.5)
        if code:raise ValueError('Approval window could not start. See '+str(logfile)+'. If device policy blocks scripts, use companion_local.py; do not bypass that policy.')
    except subprocess.TimeoutExpired:pass
    return {'opened':True,'log':str(logfile)}


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--workspace',type=Path)
    args=parser.parse_args()
    from launcher import default_workspace
    try:launch(args.workspace or default_workspace())
    except Exception as error:
        if os.name=='nt':
            import ctypes
            ctypes.windll.user32.MessageBoxW(None,str(error),'Bedazzle approvals',0x10)
        else:raise SystemExit(str(error))
