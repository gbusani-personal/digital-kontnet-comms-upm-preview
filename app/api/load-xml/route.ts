import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get("url");

  if (!url) {
    return NextResponse.json({ error: "Missing url query parameter." }, { status: 400 });
  }

  let parsedUrl: URL;

  try {
    parsedUrl = new URL(url);
  } catch {
    return NextResponse.json({ error: "Invalid URL format." }, { status: 400 });
  }

  if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
    return NextResponse.json(
      { error: "Only http and https URLs are allowed." },
      { status: 400 }
    );
  }

  try {
    // Server-side fetch avoids browser CORS restrictions for public XML blobs.
    const upstreamResponse = await fetch(parsedUrl.toString(), {
      cache: "no-store",
      headers: {
        Accept: "application/xml,text/xml;q=0.9,*/*;q=0.8",
      },
    });

    if (!upstreamResponse.ok) {
      return NextResponse.json(
        {
          error: `Unable to load XML from source. Status: ${upstreamResponse.status}.`,
        },
        { status: upstreamResponse.status }
      );
    }

    const xmlText = await upstreamResponse.text();

    return new NextResponse(xmlText, {
      status: 200,
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
      },
    });
  } catch {
    return NextResponse.json(
      {
        error: "Unable to reach the source URL. Verify the XML URL is publicly accessible.",
      },
      { status: 502 }
    );
  }
}