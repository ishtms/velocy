// State Management
let requestHistory = [];
let savedRequests = [];
let wsConnection = null;
let currentResponse = null;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    initializeEventListeners();
    loadSavedRequests();
    loadAvailableRoutes();
    initializeTabs();
    initializeBodyTypeSelector();
    initializeAuthSelector();
});

// Navigation
function initializeEventListeners() {
    // Navigation
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const view = item.dataset.view;
            switchView(view);
            
            // Update active state
            document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
            item.classList.add('active');
        });
    });
    
    // Send button
    document.getElementById('send-btn').addEventListener('click', sendRequest);
    
    // Enter key in URL input
    document.getElementById('url').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            sendRequest();
        }
    });
    
    // WebSocket controls
    document.getElementById('ws-connect').addEventListener('click', connectWebSocket);
    document.getElementById('ws-disconnect').addEventListener('click', disconnectWebSocket);
    document.getElementById('ws-send').addEventListener('click', sendWebSocketMessage);
    
    // File input
    document.getElementById('file-input').addEventListener('change', handleFileSelect);
}

function switchView(viewName) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const view = document.getElementById(`${viewName}-view`);
    if (view) {
        view.classList.add('active');
    }
}

// Tabs
function initializeTabs() {
    document.querySelectorAll('.tabs').forEach(tabContainer => {
        tabContainer.querySelectorAll('.tab').forEach(tab => {
            tab.addEventListener('click', () => {
                const tabName = tab.dataset.tab;
                const parent = tab.closest('.request-tabs, .response-tabs');
                
                // Update active tab
                parent.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                
                // Update active panel
                parent.querySelectorAll('.tab-panel').forEach(panel => {
                    panel.classList.remove('active');
                });
                const panel = parent.querySelector(`#${tabName}-tab`);
                if (panel) {
                    panel.classList.add('active');
                }
            });
        });
    });
}

// Body Type Selector
function initializeBodyTypeSelector() {
    document.querySelectorAll('input[name="body-type"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            const type = e.target.value;
            document.querySelectorAll('.body-content').forEach(content => {
                content.classList.remove('active');
            });
            document.getElementById(`body-${type}`).classList.add('active');
        });
    });
}

// Auth Selector
function initializeAuthSelector() {
    const authType = document.getElementById('auth-type');
    if (authType) {
        authType.addEventListener('change', (e) => {
            const type = e.target.value;
            document.querySelectorAll('.auth-content').forEach(content => {
                content.classList.remove('active');
            });
            document.getElementById(`auth-${type}`).classList.add('active');
        });
    }
}

// Key-Value Editors
function addParamRow() {
    addKeyValueRow('params-list');
}

function addHeaderRow() {
    addKeyValueRow('headers-list');
}

function addFormRow() {
    addKeyValueRow('form-list');
}

function addKeyValueRow(listId) {
    const list = document.getElementById(listId);
    const row = document.createElement('div');
    row.className = 'kv-row';
    row.innerHTML = `
        <input type="text" placeholder="Key" class="kv-key">
        <input type="text" placeholder="Value" class="kv-value">
        <button class="btn-remove" onclick="this.parentElement.remove()"><i class="fas fa-times"></i></button>
    `;
    list.appendChild(row);
}

// Cookie Management
function addCookie() {
    const cookiesList = document.getElementById('cookies-list');
    const cookieItem = document.createElement('div');
    cookieItem.className = 'cookie-item';
    cookieItem.innerHTML = `
        <input type="text" placeholder="Cookie name" class="cookie-name">
        <input type="text" placeholder="Cookie value" class="cookie-value">
        <button class="btn-remove" onclick="this.parentElement.remove()"><i class="fas fa-times"></i></button>
    `;
    cookiesList.appendChild(cookieItem);
}

// File Handling
function handleFileSelect(e) {
    const files = e.target.files;
    const fileList = document.getElementById('file-list');
    fileList.innerHTML = '';
    
    Array.from(files).forEach(file => {
        const fileItem = document.createElement('div');
        fileItem.className = 'file-item';
        fileItem.innerHTML = `
            <span>${file.name} (${formatFileSize(file.size)})</span>
            <button class="btn-remove" onclick="removeFile('${file.name}')">
                <i class="fas fa-times"></i>
            </button>
        `;
        fileList.appendChild(fileItem);
    });
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

// Request Building
function buildRequestOptions() {
    const method = document.getElementById('method').value;
    const url = document.getElementById('url').value;
    
    // Build query parameters
    const params = getKeyValuePairs('params-list');
    const queryString = buildQueryString(params);
    const fullUrl = queryString ? `${url}?${queryString}` : url;
    
    // Build headers
    const headers = getKeyValuePairs('headers-list');
    
    // Add authentication
    const authType = document.getElementById('auth-type').value;
    if (authType === 'bearer') {
        const token = document.getElementById('bearer-token').value;
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }
    } else if (authType === 'basic') {
        const username = document.getElementById('basic-username').value;
        const password = document.getElementById('basic-password').value;
        if (username) {
            const encoded = btoa(`${username}:${password}`);
            headers['Authorization'] = `Basic ${encoded}`;
        }
    } else if (authType === 'apikey') {
        const keyName = document.getElementById('api-key-name').value || 'X-API-Key';
        const keyValue = document.getElementById('api-key-value').value;
        const location = document.getElementById('api-key-location').value;
        if (keyValue) {
            if (location === 'header') {
                headers[keyName] = keyValue;
            }
        }
    }
    
    // Build body
    let body = null;
    const bodyType = document.querySelector('input[name="body-type"]:checked').value;
    
    if (bodyType === 'json') {
        const jsonInput = document.getElementById('json-input').value;
        if (jsonInput) {
            try {
                JSON.parse(jsonInput); // Validate JSON
                body = jsonInput;
                headers['Content-Type'] = 'application/json';
            } catch (e) {
                showError('Invalid JSON in body');
                return null;
            }
        }
    } else if (bodyType === 'form') {
        const formData = getKeyValuePairs('form-list');
        if (Object.keys(formData).length > 0) {
            body = new URLSearchParams(formData).toString();
            headers['Content-Type'] = 'application/x-www-form-urlencoded';
        }
    } else if (bodyType === 'raw') {
        body = document.getElementById('raw-input').value;
    } else if (bodyType === 'file') {
        const fileInput = document.getElementById('file-input');
        if (fileInput.files.length > 0) {
            const formData = new FormData();
            Array.from(fileInput.files).forEach(file => {
                formData.append('files', file);
            });
            body = formData;
            // Don't set Content-Type for FormData, browser will set it with boundary
        }
    }
    
    return {
        method,
        url: fullUrl,
        headers,
        body
    };
}

function getKeyValuePairs(listId) {
    const pairs = {};
    const list = document.getElementById(listId);
    if (list) {
        list.querySelectorAll('.kv-row').forEach(row => {
            const key = row.querySelector('.kv-key').value;
            const value = row.querySelector('.kv-value').value;
            if (key) {
                pairs[key] = value;
            }
        });
    }
    return pairs;
}

function buildQueryString(params) {
    return Object.entries(params)
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
        .join('&');
}

// Send Request
async function sendRequest() {
    const options = buildRequestOptions();
    if (!options) return;
    
    const startTime = Date.now();
    const sendBtn = document.getElementById('send-btn');
    
    // Update UI
    sendBtn.disabled = true;
    sendBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending...';
    clearResponse();
    
    try {
        const fetchOptions = {
            method: options.method,
            headers: options.headers
        };
        
        if (options.body && options.body instanceof FormData) {
            fetchOptions.body = options.body;
        } else if (options.body) {
            fetchOptions.body = options.body;
        }
        
        const response = await fetch(`http://localhost:3000${options.url}`, fetchOptions);
        const responseTime = Date.now() - startTime;
        
        // Get response data
        const contentType = response.headers.get('content-type') || '';
        let responseData;
        
        if (contentType.includes('application/json')) {
            responseData = await response.json();
        } else {
            responseData = await response.text();
        }
        
        // Display response
        displayResponse(response, responseData, responseTime);
        
        // Save to history
        saveToHistory({
            timestamp: new Date().toISOString(),
            request: options,
            response: {
                status: response.status,
                statusText: response.statusText,
                headers: Object.fromEntries(response.headers.entries()),
                data: responseData,
                time: responseTime
            }
        });
        
    } catch (error) {
        showError(`Request failed: ${error.message}`);
    } finally {
        sendBtn.disabled = false;
        sendBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Send';
    }
}

// Response Display
function displayResponse(response, data, responseTime) {
    // Update status
    const statusEl = document.getElementById('response-status');
    statusEl.textContent = `${response.status} ${response.statusText}`;
    statusEl.className = 'response-status';
    if (response.status >= 200 && response.status < 300) {
        statusEl.classList.add('success');
    } else if (response.status >= 400) {
        statusEl.classList.add('error');
    }
    
    // Update time
    document.getElementById('response-time').textContent = `${responseTime}ms`;
    
    // Update size
    const size = new Blob([typeof data === 'string' ? data : JSON.stringify(data)]).size;
    document.getElementById('response-size').textContent = formatFileSize(size);
    
    // Display body
    const bodyEl = document.getElementById('response-body');
    if (typeof data === 'object') {
        bodyEl.innerHTML = `<code class="language-json">${JSON.stringify(data, null, 2)}</code>`;
    } else {
        bodyEl.innerHTML = `<code>${escapeHtml(data)}</code>`;
    }
    
    // Highlight code
    if (window.Prism) {
        Prism.highlightElement(bodyEl.querySelector('code'));
    }
    
    // Display headers
    const headersEl = document.getElementById('response-headers');
    headersEl.innerHTML = '';
    response.headers.forEach((value, key) => {
        const row = document.createElement('div');
        row.className = 'header-row';
        row.innerHTML = `
            <div class="header-name">${key}</div>
            <div class="header-value">${value}</div>
        `;
        headersEl.appendChild(row);
    });
    
    // Display cookies
    const cookiesEl = document.getElementById('response-cookies');
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) {
        cookiesEl.innerHTML = `<div class="cookie-value">${setCookie}</div>`;
    } else {
        cookiesEl.innerHTML = '<p class="info-text">No cookies in response</p>';
    }
    
    // Display raw
    const rawEl = document.getElementById('response-raw');
    const rawResponse = `${response.status} ${response.statusText}\n${Array.from(response.headers.entries()).map(([k, v]) => `${k}: ${v}`).join('\n')}\n\n${typeof data === 'string' ? data : JSON.stringify(data, null, 2)}`;
    rawEl.innerHTML = `<code>${escapeHtml(rawResponse)}</code>`;
    
    currentResponse = data;
}

function clearResponse() {
    document.getElementById('response-status').textContent = '';
    document.getElementById('response-time').textContent = '';
    document.getElementById('response-size').textContent = '';
    document.getElementById('response-body').innerHTML = '<code>Response will appear here...</code>';
    document.getElementById('response-headers').innerHTML = '';
    document.getElementById('response-cookies').innerHTML = '';
    document.getElementById('response-raw').innerHTML = '<code>Raw response will appear here...</code>';
}

// Response Actions
function formatResponse() {
    if (currentResponse && typeof currentResponse === 'object') {
        const bodyEl = document.getElementById('response-body');
        bodyEl.innerHTML = `<code class="language-json">${JSON.stringify(currentResponse, null, 2)}</code>`;
        if (window.Prism) {
            Prism.highlightElement(bodyEl.querySelector('code'));
        }
    }
}

function copyResponse() {
    if (currentResponse) {
        const text = typeof currentResponse === 'string' ? currentResponse : JSON.stringify(currentResponse, null, 2);
        navigator.clipboard.writeText(text).then(() => {
            showSuccess('Response copied to clipboard');
        });
    }
}

// WebSocket
function connectWebSocket() {
    const url = document.getElementById('ws-url').value;
    
    try {
        wsConnection = new WebSocket(url);
        
        wsConnection.onopen = () => {
            logWebSocketMessage('Connected to server', 'info');
            document.getElementById('ws-connect').disabled = true;
            document.getElementById('ws-disconnect').disabled = false;
            document.getElementById('ws-send').disabled = false;
        };
        
        wsConnection.onmessage = (event) => {
            logWebSocketMessage(event.data, 'received');
        };
        
        wsConnection.onerror = (error) => {
            logWebSocketMessage(`Error: ${error}`, 'error');
        };
        
        wsConnection.onclose = () => {
            logWebSocketMessage('Connection closed', 'info');
            document.getElementById('ws-connect').disabled = false;
            document.getElementById('ws-disconnect').disabled = true;
            document.getElementById('ws-send').disabled = true;
            wsConnection = null;
        };
        
    } catch (error) {
        showError(`WebSocket connection failed: ${error.message}`);
    }
}

function disconnectWebSocket() {
    if (wsConnection) {
        wsConnection.close();
    }
}

function sendWebSocketMessage() {
    if (wsConnection && wsConnection.readyState === WebSocket.OPEN) {
        const message = document.getElementById('ws-message').value;
        if (message) {
            wsConnection.send(message);
            logWebSocketMessage(message, 'sent');
            document.getElementById('ws-message').value = '';
        }
    }
}

function logWebSocketMessage(message, type) {
    const log = document.getElementById('ws-log');
    const messageEl = document.createElement('div');
    messageEl.className = `ws-message ${type}`;
    
    const time = new Date().toLocaleTimeString();
    messageEl.innerHTML = `
        <div class="ws-message-time">${time}</div>
        <div class="ws-message-content">${escapeHtml(message)}</div>
    `;
    
    log.appendChild(messageEl);
    log.scrollTop = log.scrollHeight;
}

function clearMessages() {
    document.getElementById('ws-log').innerHTML = '';
}

// Routes
async function loadAvailableRoutes() {
    try {
        const response = await fetch('http://localhost:3000/api/routes');
        const routes = await response.json();
        displayRoutes(routes);
    } catch (error) {
        console.error('Failed to load routes:', error);
    }
}

function displayRoutes(routes) {
    const routesList = document.getElementById('routes-list');
    if (!routesList) return;
    
    routesList.innerHTML = '';
    
    const defaultRoutes = [
        { method: 'GET', path: '/', description: 'Welcome endpoint' },
        { method: 'GET', path: '/api/test', description: 'Test API endpoint' },
        { method: 'POST', path: '/api/echo', description: 'Echo back request body' },
        { method: 'GET', path: '/api/users', description: 'Get all users' },
        { method: 'GET', path: '/api/users/:id', description: 'Get user by ID' },
        { method: 'POST', path: '/api/users', description: 'Create new user' },
        { method: 'PUT', path: '/api/users/:id', description: 'Update user' },
        { method: 'DELETE', path: '/api/users/:id', description: 'Delete user' },
        { method: 'POST', path: '/api/upload', description: 'File upload endpoint' },
        { method: 'GET', path: '/api/cookies', description: 'Cookie testing' },
        { method: 'POST', path: '/api/login', description: 'Authentication endpoint' },
        { method: 'GET', path: '/api/protected', description: 'Protected route (requires auth)' },
        { method: 'WebSocket', path: '/ws', description: 'WebSocket endpoint' }
    ];
    
    (routes || defaultRoutes).forEach(route => {
        const routeItem = document.createElement('div');
        routeItem.className = 'route-item';
        routeItem.innerHTML = `
            <div class="route-header">
                <span class="route-method ${route.method}">${route.method}</span>
                <span class="route-path">${route.path}</span>
            </div>
            <div class="route-description">${route.description || 'No description available'}</div>
            ${route.params ? `
                <div class="route-params">
                    <h4>Parameters:</h4>
                    ${route.params.map(param => `
                        <div class="param-item">
                            <span class="param-name">${param.name}</span>
                            <span class="param-type">${param.type || 'string'}</span>
                        </div>
                    `).join('')}
                </div>
            ` : ''}
        `;
        
        // Add click to load
        routeItem.addEventListener('click', () => {
            loadRouteIntoBuilder(route);
        });
        
        routesList.appendChild(routeItem);
    });
}

function loadRouteIntoBuilder(route) {
    document.getElementById('method').value = route.method === 'WebSocket' ? 'GET' : route.method;
    document.getElementById('url').value = route.path;
    
    // Switch to HTTP view
    switchView('http');
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    document.querySelector('[data-view="http"]').classList.add('active');
    
    showSuccess(`Loaded route: ${route.method} ${route.path}`);
}

// Storage
function saveToHistory(entry) {
    requestHistory.unshift(entry);
    if (requestHistory.length > 100) {
        requestHistory = requestHistory.slice(0, 100);
    }
    localStorage.setItem('requestHistory', JSON.stringify(requestHistory));
}

function loadSavedRequests() {
    try {
        const saved = localStorage.getItem('savedRequests');
        if (saved) {
            savedRequests = JSON.parse(saved);
        }
        
        const history = localStorage.getItem('requestHistory');
        if (history) {
            requestHistory = JSON.parse(history);
        }
    } catch (error) {
        console.error('Failed to load saved data:', error);
    }
}

// Utilities
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function showError(message) {
    console.error(message);
    // You can implement a toast notification here
}

function showSuccess(message) {
    console.log(message);
    // You can implement a toast notification here
}