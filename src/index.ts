import { Worker } from "@notionhq/workers";
import * as Builder from "@notionhq/workers/builder";
import * as Schema from "@notionhq/workers/schema";

const worker = new Worker();
export default worker;

// Example agent tool that returns a greeting
// Delete this when you're ready to start building your own tools.
worker.tool("sayHello", {
	title: "Say Hello KB",
	description: "Returns a friendly greeting for the given name.",
	schema: j.object({
		name: j.string().describe("The name to greet."),
	}),
	execute: ({ name }) => `Hello, ${name}!`,
});
const exampleApi = worker.pacer("exampleApi", {
	allowedRequests: 10,
	intervalMs: 1000,
});
const projects = worker.database("projects", {
	type: "managed",
	initialTitle: "Projects",
	primaryKeyProperty: "Project ID",
	schema: {
		properties: {
			"Project Name": Schema.title(),
			"Project ID": Schema.richText(),
		},
	},
});
worker.sync("projectsSync", {
	database: projects,
	mode: "replace",
	schedule: "1h",
	execute: async (state) => {
		const page = state?.page ?? 1;

		// optional if you kept pacer
		// await exampleApi.wait();

		const { items, hasMore } = await fetchProjects(page);

		return {
			changes: items.map((item) => ({
				type: "upsert" as const,
				key: item.id,
				properties: {
					"Project Name": Builder.title(item.name),
					"Project ID": Builder.richText(item.id),
				},
			})),
			hasMore,
			nextState: hasMore ? { page: page + 1 } : undefined,
		};
	},
});
async function fetchProjects(_page: number) {
	return {
		items: [{ id: "proj-1", name: "Example Project" }],
		hasMore: false,
	};
}
