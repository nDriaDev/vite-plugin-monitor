export const STYLES = `
	:host {
		all: initial;
		font-family: ui-monospace, 'Cascadia Code', 'Fira Code', monospace;
		font-size: 12px;
	}

	/*  FAB  */
	#fab {
		position: fixed;
		bottom: 20px;
		right: 20px;
		width: 40px;
		height: 40px;
		border-radius: 50%;
		background: #1e293b;
		border: 1.5px solid #334155;
		color: #60a5fa;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		box-shadow: 0 4px 20px #00000066;
		transition: transform 0.15s ease, box-shadow 0.15s ease;
		user-select: none;
		z-index: 2147483647;
	}

	#fab:hover {
		transform: scale(1.1);
		box-shadow: 0 6px 28px #00000088;
		border-color: #60a5fa;
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
		bottom: 70px;
		right: 20px;
		width: 320px;
		background: #0f172a;
		border: 1px solid #1e293b;
		border-radius: 12px;
		box-shadow: 0 20px 60px #000000aa;
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
		to	 {
			opacity: 1;
			transform: translateY(0);
		}
	}

	/*  Header  */
	#header {
		padding: 11px 14px;
		background: #020817;
		border-bottom: 1px solid #1e293b;
		display: flex;
		align-items: center;
		justify-content: space-between;
		cursor: move;
		user-select: none;
	}

	#header-title {
		color: #60a5fa;
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

	#close {
		background: none;
		border: none;
		color: #334155;
		cursor: pointer;
		font-size: 18px;
		line-height: 1;
		padding: 0;
		transition: color 0.1s;
		font-family: inherit;
	}

	#close:hover {
		color: #94a3b8;
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
		color: #334155;
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
		color: #475569;
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
		color: #94a3b8;
		font-size: 11px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 170px;
	}

	.row-val.highlight {
		color: #a3e635;
	}

	/*  Copy button  */
	.copy-btn {
		background: none;
		border: 1px solid #1e293b;
		color: #334155;
		border-radius: 3px;
		padding: 1px 5px;
		cursor: pointer;
		font-size: 9px;
		font-family: inherit;
		flex-shrink: 0;
		transition: color 0.1s, border-color 0.1s;
	}
	.copy-btn:hover	{
		color: #60a5fa;
		border-color: #60a5fa;
	}
	.copy-btn.copied {
		color: #22c55e;
		border-color: #22c55e;
	}

	/* Divider */
	.divider {
		height: 1px;
		background: #1e293b;
		margin: 0 -14px;
	}

	/* Dashboard link */
	#dashboard-link {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 10px 12px;
		background: #1e293b33;
		border: 1px solid #1e293b;
		border-radius: 8px;
		text-decoration: none;
		color: #60a5fa;
		font-size: 12px;
		font-weight: 600;
		font-family: inherit;
		transition: background 0.15s, border-color 0.15s;
		cursor: pointer;
	}

	#dashboard-link:hover {
		background: #1e293b88;
		border-color: #334155;
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
		border: 1px solid #1e293b;
		color: #334155;
		border-radius: 3px;
		padding: 1px 5px;
		cursor: pointer;
		font-size: 9px;
		font-family: inherit;
		flex-shrink: 0;
		transition: color 0.1s, border-color 0.1s;
	}

	.edit-btn:hover {
		color: #60a5fa;
		border-color: #60a5fa;
	}

	#userid-edit-row {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 4px 0;
	}

	.userid-input {
		width: 100%;
		background: #0f172a;
		border: 1px solid #334155;
		border-radius: 4px;
		color: #e2e8f0;
		font-family: inherit;
		font-size: 11px;
		padding: 4px 8px;
		outline: none;
		box-sizing: border-box;
	}

	.userid-input:focus {
		border-color: #60a5fa;
	}

	.userid-actions {
		display: flex;
		gap: 4px;
		justify-content: flex-end;
	}

	.confirm-btn, .cancel-btn {
		background: none;
		border: 1px solid #1e293b;
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

	.cancel-btn  {
		color: #ef4444;
	}

	.cancel-btn:hover  {
		border-color: #ef4444;
	}
`;
