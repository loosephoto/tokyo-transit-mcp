
import axios from 'axios';

const API_KEY = process.env.ODPT_API_KEY;
const API_BASE_URL = 'https://api.odpt.org/api/v4/datastore';

async function searchStation(stationName) {
  try {
    // Try with aclconsumer_key format
    const response = await axios.get(`${API_BASE_URL}/odpt:Station`, { 
      params: { aclconsumer_key: API_KEY },
      headers: { 'Accept': 'application/json' }
    });
    
    const found = response.data.filter(s => 
      s['dc:title'].includes(stationName) || 
      stationName.includes(s['dc:title'])
    );
    
    console.log(JSON.stringify({
      query: stationName,
      found: found.map(s => ({
        name: s['dc:title'],
        railway: s['odpt:railway']?.['@id']?.replace('odpt:Railway:', ''),
        operator: s['odpt:operator']?.['@id']?.replace('odpt:Operator:', '')
      }))
    }, null, 2));
  } catch (error) {
    console.error('Error:', error.response?.status, error.message);
    if (error.response?.data) {
      console.error('Response:', JSON.stringify(error.response.data, null, 2));
    }
  }
}

// Test with both stations
console.log("=== Testing ODPT API ===");
searchStation('東向島');
