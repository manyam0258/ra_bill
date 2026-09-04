const common_site_config = require('../../../sites/common_site_config.json');
const { webserver_port } = common_site_config;

export default {
	// Proxy Frappe backend endpoints only (do NOT include ra_bill here)
	'^/(app|api|assets|files|private|login|me|apps|helpdesk|crm|wiki|insights|hrms|desk)': {
		target: `http://127.0.0.1:${webserver_port || 8000}`,
		changeOrigin: true,
		ws: true,
	},
	// Proxy root POST/PUT/DELETE RPC requests
	'^/$': {
		target: `http://127.0.0.1:${webserver_port || 8000}`,
		changeOrigin: true,
		bypass: (req: any) => {
			if (req.method === 'GET' && req.headers.accept?.includes('text/html')) {
				return undefined;
			}
			return null;
		}
	}
};
