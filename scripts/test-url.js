const { URL } = require('url');

const urlStr = '/api/workspaces/daiyihang/datasets/flashcard_%E7%BB%8F%E6%B5%8E%E5%AD%A6_w1.json';
const url = new URL(urlStr, 'http://localhost');
const pathname = url.pathname;

console.log('Pathname:', pathname);
const datasetMatch = pathname.match(/^\/api\/workspaces\/([^\/]+)\/datasets\/(.+)$/);
if (datasetMatch) {
    const rawMatch = datasetMatch[2];
    console.log('Raw Match[2]:', rawMatch);
    const doubleDecoded = decodeURIComponent(rawMatch);
    console.log('Double Decoded:', doubleDecoded);
}
