const port = Number(process.env.PORT ?? 3000);
const dist = new URL("./dist/", import.meta.url);

Bun.serve({
  port,
  async fetch(request) {
    const pathname = new URL(request.url).pathname;
    const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    if (relativePath.includes("..")) return new Response("Not found", { status: 404 });
    const file = Bun.file(new URL(relativePath, dist));
    return (await file.exists()) ? new Response(file) : new Response("Not found", { status: 404 });
  },
});

console.log(`Dino Dash running at http://localhost:${port}`);

