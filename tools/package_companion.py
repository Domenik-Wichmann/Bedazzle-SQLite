"""Build a thin MCPB using the configured Bedazzle bundled runtime, plus skill ZIP."""
import json
from pathlib import Path
import sys
from zipfile import ZipFile, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from companion_mcp import tools_list,SERVER_VERSION


def main():
    out = ROOT / 'dist'
    out.mkdir(exist_ok=True)
    manifest = {
        'manifest_version': '0.3', 'name': 'bedazzle-local', 'display_name': 'Bedazzle Local',
        'version': SERVER_VERSION, 'description': 'Local Bedazzle data tools with versioned sources and separate edit/analysis approvals.',
        'author': {'name': 'Bedazzle contributors'},
        'server': {'type': 'node', 'entry_point': 'bridge.js', 'mcp_config': {'command': 'node', 'args': ['${__dirname}/bridge.js', '${user_config.bedazzle_folder}', '${user_config.workspace_folder}']}},
        'compatibility': {'platforms': ['win32']},
        'user_config': {
            'bedazzle_folder': {'type': 'directory', 'title': 'Bedazzle application folder', 'description': 'Updated extracted Bedazzle folder containing companion_mcp.py and runtime/python/python.exe', 'required': True},
            'workspace_folder': {'type': 'directory', 'title': 'Bedazzle workspace home', 'description': 'Workspace home containing workspaces.json and server.json (normally workspace/bedazzle)', 'required': True}},
        'tools': [{'name': t['name'], 'description': t['description']} for t in tools_list()]
    }
    # Launcher code is deliberately external: a single installed Bedazzle owns the engine.
    with ZipFile(out / 'Bedazzle-Claude-Desktop.mcpb', 'w', ZIP_DEFLATED) as archive:
        archive.writestr('manifest.json', json.dumps(manifest, indent=2))
        archive.writestr('README.txt', 'Requires the updated Bedazzle Windows application. Configure its extracted folder and workspace home. See COMPANION.md. No system Python is required.')
        archive.write(ROOT / 'companion_bridge.js', 'bridge.js')
    with ZipFile(out / 'Bedazzle-Skill.zip', 'w', ZIP_DEFLATED) as archive:
        archive.write(ROOT / 'skills/bedazzle/SKILL.md', 'bedazzle/SKILL.md')
    print(out / 'Bedazzle-Claude-Desktop.mcpb')
    print(out / 'Bedazzle-Skill.zip')


if __name__ == '__main__':
    main()
