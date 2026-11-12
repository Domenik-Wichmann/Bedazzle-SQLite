"""Human-only terminal approval surface. Never exposed as an MCP operation."""
import argparse
import json
from pathlib import Path
from companion_store import Ledger


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--workspace', required=True, type=Path)
    sub = parser.add_subparsers(dest='command', required=True)
    task = sub.add_parser('task')
    task.add_argument('--folder', action='append', required=True)
    task.add_argument('--scope', required=True)
    task.add_argument('--allow-private-images', action='store_true')
    task.add_argument('--allow-workspace-data', action='store_true')
    task.add_argument('--allow-private-downloads', action='store_true')
    approve = sub.add_parser('review')
    approve.add_argument('id')
    budget = sub.add_parser('transfer')
    budget.add_argument('task')
    budget.add_argument('--bytes', type=int, required=True)
    budget.add_argument('--reason', required=True)
    budget.add_argument('--response-bytes', type=int, default=65536)
    budget.add_argument('--rows', type=int, default=200)
    sub.add_parser('list')
    close=sub.add_parser('close');close.add_argument('task')
    args = parser.parse_args()
    registry = args.workspace / 'workspaces.json'
    if registry.exists():
        selected = json.loads(registry.read_text())['selected']
        if selected != 'primary':
            args.workspace = args.workspace / 'workspaces' / selected
    ledger = Ledger(args.workspace)
    if args.command=='list':
        print(json.dumps({'tasks':ledger.list('task',100),'approvals':[v for v in ledger.list('approval',1000) if v['status']=='pending']},ensure_ascii=False,indent=2));return
    if args.command=='close':
        value=ledger.task(args.task)
        if input('Type CLOSE to end this task: ')=='CLOSE':ledger.put('task',{**value,'active':False},value['id'])
        return
    if args.command == 'task':
        value = {'roots': [str(Path(p).resolve(strict=True)) for p in args.folder], 'scope': args.scope, 'active': True, 'budget': 1048576, 'transferred': 0, 'allow_private_images': args.allow_private_images,'allow_private_downloads':args.allow_private_downloads,'allow_workspace_data':args.allow_workspace_data}
    elif args.command == 'review':
        value = ledger.get('approval', args.id)
        if value['status'] != 'pending':
            raise SystemExit('Request already decided')
    else:
        value = ledger.task(args.task)
        if args.bytes <= value.get('budget', 1048576):
            raise SystemExit('New total byte budget must exceed current budget')
        if not 1024 <= args.response_bytes <= 4194304 or not 1 <= args.rows <= 10000:
            raise SystemExit('Choose 1 KiB to 4 MiB per response and 1 to 10000 rows')
        value = {**value, 'budget': args.bytes, 'response_bytes':args.response_bytes,'response_rows':args.rows, 'transfer_reason': args.reason}
    if args.command=='review':
        from companion_control import describe_approval
        print(json.dumps(describe_approval(ledger,value),indent=2,ensure_ascii=False))
    else:print(json.dumps(value, indent=2, ensure_ascii=False))
    if input('Type APPROVE to authorize exactly this request: ') != 'APPROVE':
        if args.command == 'review':
            from companion_control import execute,fingerprint
            execute({'workspace':str(args.workspace),'action':'review','id':value['id'],'fingerprint':fingerprint(value),'decision':'denied'})
        print('Not approved')
        return
    if args.command == 'review':
        from companion_control import execute,fingerprint
        decision=execute({'workspace':str(args.workspace),'action':'review','id':value['id'],'fingerprint':fingerprint(value),'decision':'approved'})
        result=ledger.get('approval',decision['id'])
    elif args.command=='transfer':
        from companion_control import execute
        decision=execute({'workspace':str(args.workspace),'action':'transfer','task':value['id'],'bytes':args.bytes,'rows':args.rows,'response_bytes':args.response_bytes,'reason':args.reason})
        result=ledger.get('task',decision['id'])
    else:
        if args.command=='task' and not registry.exists():
            # A task created before first engine startup explicitly selects the
            # primary workspace; startup must not move it into the example workspace.
            from workspaces import Workspaces
            Workspaces(args.workspace).save()
        result = ledger.put('task', value, value.get('id'))
    ledger.event({'type': 'local_authorization', 'id': result['id'], 'command': args.command})
    print(result['id'])


if __name__ == '__main__':
    main()
