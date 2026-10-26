import { env } from "./api/config/env.js";
import { GooglePlacesService } from "./api/services/googlePlacesService.js";

const svc = new GooglePlacesService();

console.log("OVERPASS_ENDPOINTS:", env.osm.overpassEndpoints);
console.log("placesApiKey:", env.google.placesApiKey || "(empty)");

async function run() {
  console.log("\n=== Test 1: restaurant, United States, quick ===");
  try {
    const r = await svc.search({ query: "restaurant", country: "United States", limit: 3, searchDepth: "quick" });
    console.log("Source:", r.source);
    console.log("Leads:", r.leads?.length || 0);
    if (r.leads?.[0]) console.log("First lead:", JSON.stringify(r.leads[0], null, 2).substring(0, 500));
  } catch (e) {
    console.log("Error:", e.message);
  }

  console.log("\n=== Test 2: restaurant, mapLink coordinates ===");
  try {
    const r = await svc.search({ query: "restaurant", mapLink: "https://maps.google.com/?q=40.7128,-74.0060", limit: 3, searchDepth: "quick" });
    console.log("Source:", r.source);
    console.log("Leads:", r.leads?.length || 0);
  } catch (e) {
    console.log("Error:", e.message);
  }
}

run().catch(console.error);