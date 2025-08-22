// Velocy Framework Demo Client-Side JavaScript

// DOM Ready
document.addEventListener('DOMContentLoaded', function() {
  console.log('Velocy Framework Demo Loaded!');
  
  // Initialize features
  initializeAPITester();
  initializeWebSocket();
  setupNavigation();
  updateStats();
});

// API Tester
function initializeAPITester() {
  const form = document.getElementById('api-test-form');
  const methodSelect = document.getElementById('method');
  const bodyInput = document.getElementById('body');
  const responseDiv = document.getElementById('response');
  
  if (!form) return;
  
  // Show/hide body input based on method
  if (methodSelect) {
    methodSelect.addEventListener('change', function() {
      if (['POST', 'PUT', 'PATCH'].includes(this.value)) {
        if (bodyInput) bodyInput.style.display = 'block';
      } else {
        if (bodyInput) bodyInput.style.display = 'none';
      }
    });
  }
  
  // Handle form submission
  form.addEventListener('submit', async function(e) {
    e.preventDefault();
    
    const method = document.getElementById('method').value;
    const endpoint = document.getElementById('endpoint').value;
    const bodyText = document.getElementById('body-text')?.value;
    
    if (responseDiv) {
      responseDiv.textContent = 'Loading...';
      responseDiv.className = 'response-panel loading';
    }
    
    try {
      const options = {
        method: method,
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'demo-api-key-123'
        }
      };
      
      if (['POST', 'PUT', 'PATCH'].includes(method) && bodyText) {
        options.body = bodyText;
      }
      
      const response = await fetch(endpoint, options);
      
      // Check content type to determine how to parse response
      const contentType = response.headers.get('content-type');
      let data;
      
      if (contentType && contentType.includes('application/json')) {
        data = await response.json();
      } else {
        data = await response.text();
      }
      
      if (responseDiv) {
        responseDiv.textContent = JSON.stringify({
          status: response.status,
          statusText: response.statusText,
          headers: Object.fromEntries(response.headers.entries()),
          data: data
        }, null, 2);
        responseDiv.className = 'response-panel';
      }
    } catch (error) {
      if (responseDiv) {
        responseDiv.textContent = 'Error: ' + error.message;
        responseDiv.className = 'response-panel error';
      }
    }
  });
}

// WebSocket Connection
let ws = null;

function initializeWebSocket() {
  const wsStatus = document.getElementById('ws-status');
  const wsMessages = document.getElementById('ws-messages');
  const wsConnect = document.getElementById('ws-connect');
  const wsDisconnect = document.getElementById('ws-disconnect');
  const wsSend = document.getElementById('ws-send');
  const wsInput = document.getElementById('ws-input');
  
  if (!wsStatus) return;
  
  function connect() {
    if (ws && ws.readyState === WebSocket.OPEN) {
      console.log('WebSocket already connected');
      return;
    }
    
    ws = new WebSocket(`ws://${window.location.host}/ws`);
    
    ws.onopen = () => {
      console.log('WebSocket connected');
      if (wsStatus) {
        wsStatus.className = 'ws-status connected';
        wsStatus.title = 'Connected';
      }
      if (wsConnect) wsConnect.disabled = true;
      if (wsDisconnect) wsDisconnect.disabled = false;
      if (wsSend) wsSend.disabled = false;
      
      ws.send(JSON.stringify({ 
        type: 'hello', 
        message: 'Connected from browser',
        timestamp: new Date().toISOString()
      }));
    };
    
    ws.onmessage = (event) => {
      console.log('WebSocket message:', event.data);
      if (wsMessages) {
        const message = document.createElement('div');
        message.className = 'ws-message received';
        message.textContent = `[${new Date().toLocaleTimeString()}] Server: ${event.data}`;
        wsMessages.appendChild(message);
        wsMessages.scrollTop = wsMessages.scrollHeight;
      }
    };
    
    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      if (wsStatus) {
        wsStatus.className = 'ws-status disconnected';
        wsStatus.title = 'Error';
      }
    };
    
    ws.onclose = () => {
      console.log('WebSocket disconnected');
      if (wsStatus) {
        wsStatus.className = 'ws-status disconnected';
        wsStatus.title = 'Disconnected';
      }
      if (wsConnect) wsConnect.disabled = false;
      if (wsDisconnect) wsDisconnect.disabled = true;
      if (wsSend) wsSend.disabled = true;
    };
  }
  
  function disconnect() {
    if (ws) {
      ws.close();
      ws = null;
    }
  }
  
  function sendMessage() {
    if (ws && ws.readyState === WebSocket.OPEN && wsInput) {
      const message = wsInput.value.trim();
      if (message) {
        ws.send(JSON.stringify({
          type: 'message',
          content: message,
          timestamp: new Date().toISOString()
        }));
        
        if (wsMessages) {
          const messageDiv = document.createElement('div');
          messageDiv.className = 'ws-message sent';
          messageDiv.textContent = `[${new Date().toLocaleTimeString()}] You: ${message}`;
          wsMessages.appendChild(messageDiv);
          wsMessages.scrollTop = wsMessages.scrollHeight;
        }
        
        wsInput.value = '';
      }
    }
  }
  
  // Event listeners
  if (wsConnect) wsConnect.addEventListener('click', connect);
  if (wsDisconnect) wsDisconnect.addEventListener('click', disconnect);
  if (wsSend) wsSend.addEventListener('click', sendMessage);
  if (wsInput) {
    wsInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') sendMessage();
    });
  }
}

// Navigation Highlighting
function setupNavigation() {
  const navLinks = document.querySelectorAll('nav a');
  const currentPath = window.location.pathname;
  
  navLinks.forEach(link => {
    if (link.getAttribute('href') === currentPath) {
      link.classList.add('active');
    }
  });
}

// Update Statistics
async function updateStats() {
  const statsContainer = document.getElementById('stats');
  if (!statsContainer) return;
  
  try {
    const response = await fetch('/api/stats');
    const stats = await response.json();
    
    // Update stat cards
    Object.entries(stats).forEach(([key, value]) => {
      const element = document.getElementById(`stat-${key}`);
      if (element) {
        element.textContent = value;
      }
    });
  } catch (error) {
    console.error('Failed to fetch stats:', error);
  }
}

// Smooth Scrolling
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener('click', function(e) {
    e.preventDefault();
    const target = document.querySelector(this.getAttribute('href'));
    if (target) {
      target.scrollIntoView({
        behavior: 'smooth',
        block: 'start'
      });
    }
  });
});

// Copy to Clipboard
function copyToClipboard(text) {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  document.body.removeChild(textarea);
  
  // Show notification
  const notification = document.createElement('div');
  notification.className = 'notification success';
  notification.textContent = 'Copied to clipboard!';
  document.body.appendChild(notification);
  
  setTimeout(() => {
    notification.remove();
  }, 3000);
}

// Format JSON
function formatJSON(json) {
  try {
    return JSON.stringify(JSON.parse(json), null, 2);
  } catch (e) {
    return json;
  }
}

// Debounce function
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// Auto-refresh stats every 5 seconds
setInterval(updateStats, 5000);

// Export functions for global use
window.VelocyDemo = {
  copyToClipboard,
  formatJSON,
  debounce,
  updateStats,
  ws: () => ws
};