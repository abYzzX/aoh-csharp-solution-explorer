import * as vscode from 'vscode';

export function getWebviewHtml(webview: vscode.Webview): string {
        const nonce = `${Date.now()}${Math.random().toString(16).slice(2)}`;

        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; img-src ${webview.cspSource} data:; font-src ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
    :root {
        --aoh-item-spacing: 2px;
        --aoh-row-height: 22px;
        --aoh-indent: 18px;
        --aoh-guide-x: 4px;
        --aoh-twisty-offset: 14px;
    }

    * { box-sizing: border-box; }

    body {
        margin: 0;
        padding: 2px 0 8px 0;
        color: var(--vscode-foreground);
        background: transparent;
        font-family: var(--vscode-font-family);
        font-size: var(--vscode-font-size);
        user-select: none;
        overflow-x: hidden;
    }

    #tree {
        min-width: 100%;
    }

    .node {
        position: relative;
    }

    .row {
        position: relative;
        display: flex;
        align-items: center;
        min-height: var(--aoh-row-height);
        padding-top: var(--aoh-item-spacing);
        padding-bottom: var(--aoh-item-spacing);
        padding-right: 6px;
        padding-left: calc(var(--aoh-depth, 0) * var(--aoh-indent));
        white-space: nowrap;
        cursor: default;
    }

    .row:hover {
        background: var(--vscode-list-hoverBackground);
    }

    .row.selected {
        background: var(--vscode-list-activeSelectionBackground);
        color: var(--vscode-list-activeSelectionForeground);
    }

    .row.file,
    .row.project {
        cursor: pointer;
    }

    .twisty {
        flex: 0 0 16px;
        width: 16px;
        height: 16px;
        margin-left: var(--aoh-twisty-offset);
        display: grid;
        place-items: center;
        color: var(--vscode-icon-foreground);
        opacity: .9;
        position: relative;
        z-index: 1;
    }

    .twisty::before {
        content: '';
        width: 6px;
        height: 6px;
        border-right: 1.5px solid currentColor;
        border-bottom: 1.5px solid currentColor;
        transform: rotate(-45deg);
        transition: transform 70ms ease;
    }

    .node.expanded > .row > .twisty::before {
        transform: rotate(45deg) translate(-1px, -1px);
    }

    .twisty.empty::before {
        display: none;
    }

    /* Leaf nodes have no expand arrow. Keep only half of the twisty slot so the
       icon moves a little left, while the explicit depth still preserves hierarchy. */
    .twisty.empty {
        flex: 0 0 8px;
        width: 8px;
        height: 16px;
        margin-left: var(--aoh-twisty-offset);
    }

    .row > .icon {
        margin-left: 0;
    }

    .icon {
        flex: 0 0 16px;
        width: 16px;
        height: 16px;
        margin-right: 5px;
        color: var(--vscode-icon-foreground);
        opacity: .95;
        display: inline-flex;
        align-items: center;
        justify-content: center;
    }

    .icon svg,
    .icon .theme-file-icon {
        width: 16px;
        height: 16px;
        object-fit: contain;
        fill: currentColor;
        stroke: currentColor;
    }

    .icon .theme-font-icon {
        display: inline-block;
        width: 16px;
        text-align: center;
        line-height: 16px;
        font-style: normal;
        font-weight: normal;
    }

    .label {
        overflow: hidden;
        text-overflow: ellipsis;
        min-width: 0;
    }

    .row.dependencyGroup .label {
        color: var(--vscode-descriptionForeground);
    }

    .description {
        margin-left: auto;
        padding-left: 10px;
        color: var(--vscode-descriptionForeground);
        font-size: .92em;
    }

    .children {
        display: none;
        position: relative;
        margin-left: 0;
    }

    .node.expanded > .children {
        display: block;
    }

    body.root-lines .children::before {
        display: none;
    }

    body.root-lines .children > .node > .row::before {
        content: '';
        position: absolute;
        left: calc(var(--aoh-depth, 0) * var(--aoh-indent) + var(--aoh-guide-x));
        width: 12px;
        top: 50%;
        border-top: 1px solid var(--vscode-tree-indentGuidesStroke, rgba(128,128,128,.35));
        pointer-events: none;
    }

    .git-modified .label, .git-modified .icon {
        color: var(--vscode-gitDecoration-modifiedResourceForeground);
    }
    .git-added .label, .git-added .icon {
        color: var(--vscode-gitDecoration-addedResourceForeground);
    }
    .git-deleted .label, .git-deleted .icon {
        color: var(--vscode-gitDecoration-deletedResourceForeground);
    }
    .git-renamed .label, .git-renamed .icon {
        color: var(--vscode-gitDecoration-renamedResourceForeground);
    }
    .git-conflict .label, .git-conflict .icon {
        color: var(--vscode-gitDecoration-conflictingResourceForeground);
    }

    .empty {
        padding: 8px 12px;
        color: var(--vscode-descriptionForeground);
    }

    .context-menu {
        position: fixed;
        z-index: 10000;
        min-width: 210px;
        padding: 4px;
        border: 1px solid var(--vscode-menu-border, var(--vscode-widget-border));
        background: var(--vscode-menu-background, var(--vscode-editorWidget-background));
        color: var(--vscode-menu-foreground, var(--vscode-foreground));
        box-shadow: 0 4px 14px rgba(0,0,0,.28);
        border-radius: 3px;
        font-family: var(--vscode-font-family);
        font-size: var(--vscode-font-size);
    }

    .context-menu.hidden {
        display: none;
    }

    .context-menu-item {
        position: relative;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 20px;
        min-height: 24px;
        padding: 3px 8px;
        border-radius: 2px;
        white-space: nowrap;
        cursor: default;
    }

    .context-menu-item.has-submenu::after {
        content: '›';
        margin-left: 16px;
        opacity: .8;
        font-size: 16px;
        line-height: 1;
    }


    .context-menu-header {
        display: none;
        align-items: center;
        gap: 6px;
        padding: 3px 8px 6px;
        margin-bottom: 3px;
        border-bottom: 1px solid var(--vscode-menu-separatorBackground, var(--vscode-menu-border, var(--vscode-widget-border)));
        font-size: 12px;
        font-weight: 600;
    }

    .context-menu-header.visible {
        display: flex;
        cursor: pointer;
    }

    .context-menu-header.visible:hover {
        background: var(--vscode-menu-selectionBackground, var(--vscode-list-hoverBackground));
        color: var(--vscode-menu-selectionForeground, var(--vscode-foreground));
    }

    .context-menu-back {
        border: 0;
        background: transparent;
        color: inherit;
        padding: 0 3px 0 0;
        font: inherit;
        cursor: pointer;
    }

    .context-menu-back:hover {
        color: var(--vscode-textLink-foreground);
    }

    .context-menu-title {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .context-submenu {
        display: none;
        position: absolute;
        left: calc(100% + 2px);
        top: -5px;
        min-width: 210px;
        padding: 4px;
        border: 1px solid var(--vscode-menu-border, var(--vscode-widget-border));
        background: var(--vscode-menu-background, var(--vscode-editorWidget-background));
        color: var(--vscode-menu-foreground, var(--vscode-foreground));
        box-shadow: 0 4px 14px rgba(0,0,0,.28);
        border-radius: 3px;
        z-index: 10001;
    }

    .context-menu-item.has-submenu:hover > .context-submenu { display: none; }

    .context-menu-item:hover {
        background: var(--vscode-menu-selectionBackground, var(--vscode-list-hoverBackground));
        color: var(--vscode-menu-selectionForeground, var(--vscode-list-hoverForeground));
    }

    .context-menu-item.disabled {
        opacity: .45;
        pointer-events: none;
    }

    .context-menu-separator {
        height: 1px;
        margin: 4px 2px;
        background: var(--vscode-menu-separatorBackground, var(--vscode-widget-border));
    }
</style>
<style id="aoh-icon-fonts"></style>
</head>
<body>
<div id="tree"></div>
<div id="context-menu" class="context-menu hidden"></div>
<script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const tree = document.getElementById('tree');
    const contextMenu = document.getElementById('context-menu');
    const expanded = new Set();
    let selectedId;
    let contextTarget;

    function hideContextMenu() {
        contextMenu.classList.add('hidden');
        contextMenu.innerHTML = '';
        contextTarget = undefined;
    }

    let contextMenuRequestId = 0;
    const pendingContextMenus = new Map();

    function requestContextMenu(row, clientX, clientY) {
        const uri = row.dataset.uri;
        const kind = row.dataset.kind;
        const solutionFolderPath = row.dataset.solutionFolderPath
            ? JSON.parse(row.dataset.solutionFolderPath)
            : undefined;

        if (!uri || kind === 'dependencies' || kind === 'dependencyGroup' || kind === 'dependency') {
            hideContextMenu();
            return;
        }

        const requestId = ++contextMenuRequestId;
        pendingContextMenus.set(requestId, { row, clientX, clientY, uri, kind, solutionFolderPath });

        vscode.postMessage({
            type: 'requestContextMenu',
            requestId,
            uri,
            kind,
            solutionFolderPath
        });
    }

    function menuHtml(items) {
        return items.map((item, index) => {
            if (item.separator) return '<div class="context-menu-separator"></div>';

            const disabled = item.enabled === false ? ' disabled' : '';
            const hasChildren = Array.isArray(item.children) && item.children.length > 0;
            if (hasChildren) {
                return '<div class="context-menu-item has-submenu' + disabled + '" data-submenu-index="' + index + '">' +
                    '<span>' + escapeHtml(item.label || '') + '</span>' +
                '</div>';
            }

            const action = item.command?.startsWith('aoh.internal.')
                ? item.command.slice('aoh.internal.'.length)
                : (item.command ? 'command:' + item.command : '');

            return '<div class="context-menu-item' + disabled + '" data-action="' +
                escapeHtml(action) + '"><span>' + escapeHtml(item.label || '') + '</span></div>';
        }).join('');
    }


    function renderContextMenuLevel(items, title) {
        const headerVisible = contextMenuStack.length > 0;
        const header =
            '<div class="context-menu-header' + (headerVisible ? ' visible' : '') + '">' +
                '<button class="context-menu-back" type="button" title="Back">‹</button>' +
                '<span class="context-menu-title">' + escapeHtml(title || '') + '</span>' +
            '</div>';

        contextMenu.innerHTML = header + menuHtml(items || []);
    }

    function openContextSubmenu(itemIndex) {
        const current = contextMenuStack.length
            ? contextMenuStack[contextMenuStack.length - 1].items
            : contextMenuRootItems;

        const item = current?.[itemIndex];
        if (!item || !Array.isArray(item.children) || item.children.length === 0) return;

        contextMenuStack.push({
            title: item.label || '',
            items: item.children
        });

        renderContextMenuLevel(item.children, item.label || '');
        keepContextMenuInBounds();
    }

    function closeContextSubmenu() {
        if (!contextMenuStack.length) return;

        contextMenuStack.pop();

        if (!contextMenuStack.length) {
            renderContextMenuLevel(contextMenuRootItems, '');
        } else {
            const current = contextMenuStack[contextMenuStack.length - 1];
            renderContextMenuLevel(current.items, current.title);
        }

        keepContextMenuInBounds();
    }

    function keepContextMenuInBounds() {
        const rect = contextMenu.getBoundingClientRect();
        const currentLeft = Number.parseFloat(contextMenu.style.left || '0') || 0;
        const currentTop = Number.parseFloat(contextMenu.style.top || '0') || 0;
        const x = Math.min(currentLeft, Math.max(4, window.innerWidth - rect.width - 4));
        const y = Math.min(currentTop, Math.max(4, window.innerHeight - rect.height - 4));
        contextMenu.style.left = x + 'px';
        contextMenu.style.top = y + 'px';
    }

    function showContextMenu(items, request) {
        if (!request || !Array.isArray(items) || items.length === 0) {
            hideContextMenu();
            return;
        }

        contextTarget = {
            uri: request.uri,
            kind: request.kind,
            solutionFolderPath: request.solutionFolderPath
        };
        contextMenuRootItems = items;
        contextMenuStack = [];
        renderContextMenuLevel(items, '');
        contextMenu.classList.remove('hidden');
        contextMenu.style.left = request.clientX + 'px';
        contextMenu.style.top = request.clientY + 'px';
        keepContextMenuInBounds();
    }

    function escapeHtml(value) {
        return String(value)
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#039;');
    }

    function iconHtml(node) {
        const icon = node.icon;

        if (icon?.type === 'path') {
            return '<img class="theme-file-icon" src="' + escapeHtml(icon.uri) + '" alt="">';
        }

        if (icon?.type === 'font') {
            const style =
                'font-family:aoh-icon-' + String(icon.fontId).replace(/[^a-zA-Z0-9_-]/g, '_') + ';' +
                (icon.color ? 'color:' + icon.color + ';' : '') +
                (icon.size ? 'font-size:' + icon.size + ';' : '');

            return '<span class="theme-font-icon" style="' + escapeHtml(style) + '">' +
                escapeHtml(icon.character) +
            '</span>';
        }

        // Fallback only when the active file icon theme cannot be resolved.
        const common = 'viewBox="0 0 16 16" aria-hidden="true" focusable="false"';

        if (node.kind === 'solution' || node.kind === 'project') {
            return '<svg ' + common + '><path d="M3 2h10v12H3V2Zm1 1v10h8V3H4Zm1.5 2h5v1h-5V5Zm0 2.5h5v1h-5v-1Zm0 2.5h3.5v1H5.5v-1Z"/></svg>';
        }

        if (node.kind === 'solutionFolder' || node.kind === 'folder' || node.kind === 'properties') {
            return '<svg ' + common + '><path d="M1.5 3.25h5l1.25 1.5h6.75v8H1.5v-9.5Zm1 1v7.5h11v-6h-6.2L6.05 4.25H2.5Z"/></svg>';
        }

        if (node.kind === 'dependencies') {
            return '<svg ' + common + '><path d="M4 2.5A2.5 2.5 0 1 1 4 7.5a2.5 2.5 0 0 1 0-5Zm8 6A2.5 2.5 0 1 1 12 13.5a2.5 2.5 0 0 1 0-5ZM6.1 5.6l4 4-.7.7-4-4 .7-.7Z"/></svg>';
        }

        if (node.kind === 'dependencyGroup') {
            return '<svg ' + common + '><path d="M1.5 3.25h5l1.25 1.5h6.75v8H1.5v-9.5Zm1 1v7.5h11v-6h-6.2L6.05 4.25H2.5Z"/></svg>';
        }

        if (node.kind === 'dependency') {
            return '<svg ' + common + '><path d="M8 1.5 14 4.7v6.6L8 14.5l-6-3.2V4.7L8 1.5Z"/></svg>';
        }

        return '<svg ' + common + '><path d="M3 1.5h6l4 4v9H3v-13Zm1 1v11h8V6H8.5V2.5H4Zm5.5.7V5h1.8L9.5 3.2Z"/></svg>';
    }

    function nodeHtml(node, depth = 0) {
        const hasChildren = Array.isArray(node.children) && node.children.length > 0;
        const isExpanded = expanded.has(node.id) || (node.expanded && !expanded.has('collapsed:' + node.id));
        const gitClass = node.gitState ? ' git-' + node.gitState : '';
        const selected = selectedId === node.id ? ' selected' : '';

        const children = hasChildren
            ? '<div class="children">' + node.children.map(child => nodeHtml(child, depth + 1)).join('') + '</div>'
            : '';

        return '<div class="node ' + (isExpanded ? 'expanded' : '') + '" data-id="' + escapeHtml(node.id) + '">' +
            '<div class="row ' + escapeHtml(node.kind) + gitClass + selected + '" ' +
                'style="--aoh-depth:' + depth + ';" ' +
                'data-id="' + escapeHtml(node.id) + '" ' +
                'data-uri="' + escapeHtml(node.uri || '') + '" ' +
                'data-kind="' + escapeHtml(node.kind) + '" ' +
                'data-solution-folder-path="' + escapeHtml(JSON.stringify(node.solutionFolderPath || [])) + '">' +
                '<span class="twisty ' + (hasChildren ? '' : 'empty') + '"></span>' +
                '<span class="icon ' + escapeHtml(node.kind) + '">' + iconHtml(node) + '</span>' +
                '<span class="label">' + escapeHtml(node.label) + '</span>' +
                (node.description ? '<span class="description">' + escapeHtml(node.description) + '</span>' : '') +
            '</div>' +
            children +
        '</div>';
    }

    function applySettings(settings) {
        document.documentElement.style.setProperty(
            '--aoh-item-spacing',
            Math.max(0, Number(settings.itemSpacing || 0)) + 'px'
        );

    }

    function render(roots) {
        if (!roots || roots.length === 0) {
            tree.innerHTML = '<div class="empty">No solution found.</div>';
            return;
        }

        tree.innerHTML = roots.map(node => nodeHtml(node, 0)).join('');
    }

    tree.addEventListener('click', event => {
        const row = event.target.closest('.row');
        if (!row) return;

        const id = row.dataset.id;
        const uri = row.dataset.uri;
        const node = row.parentElement;
        const hasChildren = !!node.querySelector(':scope > .children');

        selectedId = id;

        if (hasChildren) {
            const isExpanded = node.classList.contains('expanded');

            if (isExpanded) {
                expanded.delete(id);
                expanded.add('collapsed:' + id);
            } else {
                expanded.add(id);
                expanded.delete('collapsed:' + id);
            }

            node.classList.toggle('expanded', !isExpanded);
        } else if (uri && row.dataset.kind === 'file') {
            vscode.postMessage({ type: 'open', uri });
        }

        document.querySelectorAll('.row.selected').forEach(el => el.classList.remove('selected'));
        row.classList.add('selected');
    });

    tree.addEventListener('dblclick', event => {
        const row = event.target.closest('.row');
        if (!row) return;

        const uri = row.dataset.uri;
        if (uri && row.dataset.kind === 'file') {
            vscode.postMessage({ type: 'open', uri });
        }
    });

    tree.addEventListener('contextmenu', event => {
        const row = event.target.closest('.row');
        if (!row) return;

        event.preventDefault();

        document.querySelectorAll('.row.selected').forEach(el => el.classList.remove('selected'));
        row.classList.add('selected');
        selectedId = row.dataset.id;

        requestContextMenu(row, event.clientX, event.clientY);
    });
    contextMenu.addEventListener('click', event => {
        const header = event.target.closest('.context-menu-header.visible');
        if (header) {
            event.preventDefault();
            event.stopPropagation();
            closeContextSubmenu();
            return;
        }

        const item = event.target.closest('.context-menu-item');
        if (!item || !contextTarget || item.classList.contains('disabled')) return;

        if (item.classList.contains('has-submenu')) {
            const index = Number.parseInt(item.dataset.submenuIndex || '-1', 10);
            if (index >= 0) {
                event.preventDefault();
                event.stopPropagation();
                openContextSubmenu(index);
            }
            return;
        }

        const action = item.dataset.action;
        if (!action) return;

        // Capture the target before hiding the menu. hideContextMenu() clears
        // contextTarget, so reading contextTarget.kind afterwards prevented
        // every action from ever being posted back to the extension host.
        const target = { ...contextTarget };

        hideContextMenu();
        vscode.postMessage({
            type: 'contextAction',
            action,
            uri: target.uri,
            kind: target.kind,
            solutionFolderPath: target.solutionFolderPath
        });
    });

    document.addEventListener('mousedown', event => {
        if (!event.target.closest('#context-menu')) hideContextMenu();
    });

    window.addEventListener('blur', hideContextMenu);
    window.addEventListener('resize', hideContextMenu);
    window.addEventListener('scroll', hideContextMenu, true);

    window.addEventListener('message', event => {
        const message = event.data;

        if (message?.type === 'contextMenu') {
            const request = pendingContextMenus.get(message.requestId);
            pendingContextMenus.delete(message.requestId);
            showContextMenu(message.items || [], request);
            return;
        }

        if (message?.type !== 'tree') return;

        applySettings(message.settings || {});
        document.getElementById('aoh-icon-fonts').textContent = message.iconFontCss || '';
        render(message.roots || []);
    });

    vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
    }
