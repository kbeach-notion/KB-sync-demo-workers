import { Worker } from "@notionhq/workers";
import * as Builder from "@notionhq/workers/builder";
import * as Schema from "@notionhq/workers/schema";

const worker = new Worker();
export default worker;

// --- Spotify auth ---

async function getSpotifyAccessToken(): Promise<string> {
	const clientId = process.env.SPOTIFY_CLIENT_ID ?? "";
	const clientSecret = process.env.SPOTIFY_CLIENT_SECRET ?? "";
	const refreshToken = process.env.SPOTIFY_REFRESH_TOKEN ?? "";

	const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

	const res = await fetch("https://accounts.spotify.com/api/token", {
		method: "POST",
		headers: {
			Authorization: `Basic ${credentials}`,
			"Content-Type": "application/x-www-form-urlencoded",
		},
		body: new URLSearchParams({
			grant_type: "refresh_token",
			refresh_token: refreshToken,
		}),
	});

	if (!res.ok) {
		throw new Error(`Spotify token refresh failed (${res.status}): ${await res.text()}`);
	}

	const data = (await res.json()) as { access_token: string };
	return data.access_token;
}

// --- Types ---

interface SpotifyTrack {
	id: string;
	name: string;
	artists: Array<{ name: string }>;
	album: { name: string; images: Array<{ url: string }> };
	popularity: number;
}

interface SpotifyTopTracksResponse {
	items: SpotifyTrack[];
	next: string | null;
}

// --- Database & pacer ---

const tracks = worker.database("tracks", {
	type: "managed",
	initialTitle: "Top Spotify Tracks",
	primaryKeyProperty: "Track ID",
	schema: {
		properties: {
			"Track Name": Schema.title(),
			"Track ID": Schema.richText(),
			"Artist": Schema.richText(),
			"Album": Schema.richText(),
			"Rank": Schema.number(),
			"Album Art": Schema.file(),
		},
	},
});

const spotifyApi = worker.pacer("spotifyApi", { allowedRequests: 5, intervalMs: 1000 });

// --- Sync ---

worker.sync("topTracksSync", {
	database: tracks,
	mode: "replace",
	schedule: "1h",
	execute: async (state: { next?: string; rankOffset?: number } | undefined) => {
		const token = await getSpotifyAccessToken();
		await spotifyApi.wait();

		const rankOffset = state?.rankOffset ?? 0;
		const url =
			state?.next ??
			"https://api.spotify.com/v1/me/top/tracks?limit=50&time_range=medium_term";

		const res = await fetch(url, {
			headers: { Authorization: `Bearer ${token}` },
		});
		if (!res.ok) {
			throw new Error(`Spotify API error (${res.status}): ${await res.text()}`);
		}

		const data = (await res.json()) as SpotifyTopTracksResponse;

		return {
			changes: data.items.map((track, i) => ({
				type: "upsert" as const,
				key: track.id,
				properties: {
					"Track Name": Builder.title(track.name),
					"Track ID": Builder.richText(track.id),
					"Artist": Builder.richText(track.artists.map((a) => a.name).join(", ")),
					"Album": Builder.richText(track.album.name),
					"Rank": Builder.number(rankOffset + i + 1),
...(track.album.images[0] ? { "Album Art": Builder.file(track.album.images[0].url) } : {}),
				},
			})),
			hasMore: data.next !== null,
			nextState: data.next
				? { next: data.next, rankOffset: rankOffset + data.items.length }
				: undefined,
		};
	},
});
