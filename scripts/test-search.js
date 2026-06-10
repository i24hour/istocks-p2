// Credentials from environment variables

// Credentials(from Vercel env - user needs to provide these or we assume they are set)
// I will use placeholders and ask user to run with env vars if needed, 
// but better to try and read from.env.local if possible or hardcode for a quick test if I had them.
// Since I don't have them, I will ask the user to run this script which will fail if vars are missing.
// Wait, I can try to read from process.env in node.js script.

// Let's use a Node.js script instead since the project is Node.js and I can use the same logic.

const apiKey = process.env.GOOGLE_SEARCH_API_KEY?.trim();
const searchEngineId = process.env.GOOGLE_SEARCH_ENGINE_ID?.trim();

async function searchWeb(query) {
    if (!apiKey || !searchEngineId) {
        console.error('❌ Missing credentials');
        return;
    }

    const endpoint = 'https://www.googleapis.com/customsearch/v1';
    const params = new URLSearchParams({
        key: apiKey,
        cx: searchEngineId,
        q: query,
        num: '5',
        gl: 'in',
        dateRestrict: 'y1',
    });

    console.log(`🔍 Searching for: "${query}"`);
    console.log(`🔗 URL: ${endpoint}?${params.toString()}`);

    try {
        const response = await fetch(`${endpoint}?${params}`);
        const data = await response.json();

        if (!response.ok) {
            console.error('❌ Error:', data);
            return;
        }

        console.log(`✅ Found ${data.items?.length || 0} results`);
        if (data.items) {
            data.items.forEach((item, i) => {
                console.log(`\n${i + 1}. ${item.title}`);
                console.log(`   ${item.link}`);
            });
        }
    } catch (error) {
        console.error('❌ Exception:', error);
    }
}

// Test queries
searchWeb('Adani Power (ADANIPOWER) latest news India stock news');
searchWeb('Eternal (Zomato) latest news India stock news');
