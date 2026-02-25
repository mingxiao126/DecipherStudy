const http = require('http');

function testEndpoint(path) {
    return new Promise((resolve) => {
        const options = {
            hostname: '127.0.0.1',
            port: 8000,
            path: path,
            method: 'GET'
        };

        console.log(`Testing ${path}...`);
        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                console.log(`Status: ${res.statusCode}`);
                console.log(`Response: ${data.substring(0, 100)}${data.length > 100 ? '...' : ''}`);
                try {
                    const parsed = JSON.parse(data);
                    resolve({ status: res.statusCode, data: parsed });
                } catch (e) {
                    console.error(`Failed to parse JSON: ${e.message}`);
                    resolve({ status: res.statusCode, error: e.message });
                }
            });
        });

        req.on('error', (e) => {
            console.error(`Request error: ${e.message}`);
            resolve({ status: 0, error: e.message });
        });
        req.end();
    });
}

async function runTests() {
    console.log('--- API Diagnostic Start ---');

    // 1. Health check
    await testEndpoint('/api/health');

    // 2. User topics (daiyihang)
    await testEndpoint('/api/workspaces/daiyihang/topics?type=flashcard');

    // 3. Merged topics (daiyihang)
    await testEndpoint('/api/workspaces/daiyihang/flashcard-topics-merged');

    // 4. Shared dataset (from ualberta school / econ102 subject)
    // Filename: flashcard_经济学_w1.json
    await testEndpoint('/api/workspaces/daiyihang/datasets/flashcard_%E7%BB%8F%E6%B5%8E%E5%AD%A6_w1.json');

    // 5. Corrupted file test (seen in logs earlier)
    await testEndpoint('/api/workspaces/daiyihang/datasets/flashcard_%E7%BB%8F%E6%B5%8E%E5%AD%A6_4-6%E5%91%A8%E7%9F%A5%E8%AF%86%E7%82%B9.json');

    console.log('--- API Diagnostic End ---');
}

runTests();
