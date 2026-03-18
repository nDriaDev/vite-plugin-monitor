export const STYLES = `
	:host {
		all: initial;
		font-family: ui-monospace, 'Cascadia Code', 'Fira Code', monospace;
		font-size: 12px;

		/* Dark theme (default) */
		--ov-bg:          #020817;
		--ov-bg-header:   #0f172a;
		--ov-bg-input:    #0f172a;
		--ov-bg-link:     #1e293b33;
		--ov-border:      #1e293b;
		--ov-border-mid:  #334155;
		--ov-text-key:    #475569;
		--ov-text-val:    #94a3b8;
		--ov-text-label:  #334155;
		--ov-text-accent: #60a5fa;
		--ov-text-hi:     #a3e635;
		--ov-text-input:  #e2e8f0;
		--ov-text-close:  #334155;
		--ov-title:       #60a5fa;
		--ov-fab-bg:      #1e293b;
		--ov-fab-border:  #334155;
		--ov-shadow:      0 20px 60px #000000aa;
		--ov-fab-shadow:  0 4px 20px #00000066;
	}

	/* Light theme */
	:host(.light) {
		--ov-bg:          #f8fafc;
		--ov-bg-header:   #ffffff;
		--ov-bg-input:    #f8fafc;
		--ov-bg-link:     #f1f5f9;
		--ov-border:      #e2e8f0;
		--ov-border-mid:  #cbd5e1;
		--ov-text-key:    #64748b;
		--ov-text-val:    #475569;
		--ov-text-label:  #94a3b8;
		--ov-text-accent: #3b82f6;
		--ov-text-hi:     #16a34a;
		--ov-text-input:  #1e293b;
		--ov-text-close:  #94a3b8;
		--ov-title:       #3b82f6;
		--ov-fab-bg:      #ffffff;
		--ov-fab-border:  #e2e8f0;
		--ov-shadow:      0 20px 60px #00000033;
		--ov-fab-shadow:  0 4px 20px #00000022;
	}

	/*  FAB  */
	#fab {
		position: fixed;
		width: 40px;
		height: 40px;
		border-radius: 50%;
		background: var(--ov-fab-bg);
		border: 1.5px solid var(--ov-fab-border);
		color: var(--ov-text-accent);
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		box-shadow: var(--ov-fab-shadow);
		transition: transform 0.15s ease, box-shadow 0.15s ease;
		user-select: none;
		z-index: 2147483647;
	}

	#fab:hover {
		transform: scale(1.1);
		box-shadow: 0 6px 28px #00000088;
		border-color: var(--ov-text-accent);
	}

	#fab svg {
		width: 18px;
		height: 18px;
		pointer-events: none;
		flex-shrink: 0;
	}

	/*  Panel  */
	#panel {
		position: fixed;
		width: 320px;
		background: var(--ov-bg);
		border: 1px solid var(--ov-border);
		border-radius: 12px;
		box-shadow: var(--ov-shadow);
		overflow: hidden;
		display: none;
		z-index: 2147483647;
		animation: slideUp 0.16s ease;
	}

	#panel.open {
		display: block;
	}

	@keyframes slideUp {
		from {
			opacity: 0;
			transform: translateY(8px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	/*  Header  */
	#header {
		padding: 11px 14px;
		background: var(--ov-bg-header);
		border-bottom: 1px solid var(--ov-border);
		display: flex;
		align-items: center;
		justify-content: space-between;
		cursor: move;
		user-select: none;
	}

	#header-title {
		color: var(--ov-title);
		font-weight: 700;
		font-size: 11px;
		letter-spacing: 0.5px;
		display: flex;
		align-items: center;
		gap: 6px;
	}

	#header-title svg {
		width: 14px;
		height: 14px;
		flex-shrink: 0;
	}

	#header-actions {
		display: flex;
		align-items: center;
		gap: 4px;
	}

	#theme-toggle {
		background: none;
		border: 1px solid var(--ov-border);
		color: var(--ov-text-close);
		cursor: pointer;
		font-size: 13px;
		line-height: 1;
		padding: 2px 5px;
		border-radius: 4px;
		transition: color 0.1s, border-color 0.1s;
		font-family: inherit;
	}

	#theme-toggle:hover {
		color: var(--ov-text-accent);
		border-color: var(--ov-text-accent);
	}

	#close {
		background: none;
		border: none;
		color: var(--ov-text-close);
		cursor: pointer;
		font-size: 18px;
		line-height: 1;
		padding: 0;
		transition: color 0.1s;
		font-family: inherit;
	}

	#close:hover {
		color: var(--ov-text-val);
	}

	/*  Body  */
	#body {
		padding: 14px;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	/*  Section label  */
	.section-label {
		color: var(--ov-text-label);
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 1px;
		font-weight: 700;
		margin-bottom: 6px;
	}

	/*  Rows  */
	.row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 8px;
		padding: 3px 0;
	}

	.row-key {
		color: var(--ov-text-key);
		font-size: 11px;
		flex-shrink: 0;
	}

	.row-right {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
	}

	.row-val {
		color: var(--ov-text-val);
		font-size: 11px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 170px;
	}

	.row-val.highlight {
		color: var(--ov-text-hi);
	}

	/*  Copy / Edit buttons  */
	.copy-btn {
		background: none;
		border: 1px solid var(--ov-border);
		color: var(--ov-text-label);
		border-radius: 3px;
		padding: 1px 5px;
		cursor: pointer;
		font-size: 9px;
		font-family: inherit;
		flex-shrink: 0;
		transition: color 0.1s, border-color 0.1s;
	}
	.copy-btn:hover {
		color: var(--ov-text-accent);
		border-color: var(--ov-text-accent);
	}
	.copy-btn.copied {
		color: #22c55e;
		border-color: #22c55e;
	}

	/* Divider */
	.divider {
		height: 1px;
		background: var(--ov-border);
		margin: 0 -14px;
	}

	/* Dashboard link */
	#dashboard-link {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 10px 12px;
		background: var(--ov-bg-link);
		border: 1px solid var(--ov-border);
		border-radius: 8px;
		text-decoration: none;
		color: var(--ov-text-accent);
		font-size: 12px;
		font-weight: 600;
		font-family: inherit;
		transition: background 0.15s, border-color 0.15s;
		cursor: pointer;
	}

	#dashboard-link:hover {
		background: var(--ov-bg-link);
		border-color: var(--ov-border-mid);
	}

	#dashboard-link svg {
		width: 13px;
		height: 13px;
		flex-shrink: 0;
		opacity: 0.6;
	}

	#link-left {
		display: flex;
		align-items: center;
		gap: 7px;
	}

	#link-left svg {
		width: 14px;
		height: 14px;
		opacity: 1;
	}

	.edit-btn {
		background: none;
		border: 1px solid var(--ov-border);
		color: var(--ov-text-label);
		border-radius: 3px;
		padding: 1px 5px;
		cursor: pointer;
		font-size: 9px;
		font-family: inherit;
		flex-shrink: 0;
		transition: color 0.1s, border-color 0.1s;
	}

	.edit-btn:hover {
		color: var(--ov-text-accent);
		border-color: var(--ov-text-accent);
	}

	#userid-edit-row {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 4px 0;
	}

	.userid-input {
		width: 100%;
		background: var(--ov-bg-input);
		border: 1px solid var(--ov-border-mid);
		border-radius: 4px;
		color: var(--ov-text-input);
		font-family: inherit;
		font-size: 11px;
		padding: 4px 8px;
		outline: none;
		box-sizing: border-box;
	}

	.userid-input:focus {
		border-color: var(--ov-text-accent);
	}

	.userid-actions {
		display: flex;
		gap: 4px;
		justify-content: flex-end;
	}

	.confirm-btn, .cancel-btn {
		background: none;
		border: 1px solid var(--ov-border);
		border-radius: 3px;
		padding: 2px 8px;
		cursor: pointer;
		font-size: 11px;
		font-family: inherit;
		transition: color 0.1s, border-color 0.1s;
	}

	.confirm-btn {
		color: #22c55e;
	}

	.confirm-btn:hover {
		border-color: #22c55e;
	}

	.cancel-btn {
		color: #ef4444;
	}

	.cancel-btn:hover {
		border-color: #ef4444;
	}
`;
