import json
import urllib.parse
import urllib.request
from pathlib import Path

OUT_DIR = Path("public/objects")
OUT_DIR.mkdir(parents=True, exist_ok=True)

TARGETS = [
    (
        "m31.jpg",
        [
            "Messier 31 Andromeda Galaxy",
            "Andromeda Galaxy M31",
            "M31 Andromeda",
        ],
        "Galassia di Andromeda / M31",
    ),
    (
        "m45.jpg",
        [
            "Pleiades star cluster",
            "Seven Sisters Pleiades",
            "Messier 45",
            "M45 Pleiades",
        ],
        "Pleiadi / M45",
    ),
    (
        "m42.jpg",
        [
            "Orion Nebula",
            "Messier 42 Orion Nebula",
            "M42 Orion",
        ],
        "Nebulosa di Orione / M42",
    ),
    (
        "m44.jpg",
        [
            "Beehive Cluster",
            "Messier 44",
            "M44 Beehive Cluster",
            "Praesepe Cluster",
        ],
        "Presepe / M44",
    ),
    (
        "ngc869-884.jpg",
        [
            "Double Cluster Perseus",
            "NGC 869 NGC 884",
            "h and chi Persei",
            "Perseus Double Cluster",
        ],
        "Doppio Ammasso / NGC 869-884",
    ),
    (
        "m13.jpg",
        [
            "Hercules Globular Cluster",
            "Messier 13",
            "M13 Globular Cluster",
            "Great Globular Cluster Hercules",
        ],
        "Ammasso di Ercole / M13",
    ),
    (
        "m57.jpg",
        [
            "Ring Nebula",
            "Messier 57",
            "M57 Ring Nebula",
            "NGC 6720",
        ],
        "Nebulosa Anello / M57",
    ),
    (
        "m33.jpg",
        [
            "Triangulum Galaxy",
            "Messier 33",
            "M33 Triangulum",
        ],
        "Galassia Triangolo / M33",
    ),
    (
        "m8.jpg",
        [
            "Lagoon Nebula",
            "Messier 8",
            "M8 Lagoon Nebula",
        ],
        "Nebulosa Laguna / M8",
    ),
    (
        "m11.jpg",
        [
            "Wild Duck Cluster",
            "Messier 11",
            "M11 Wild Duck Cluster",
        ],
        "Ammasso Anatra Selvatica / M11",
    ),
    (
        "ngc7000.jpg",
        [
            "North America Nebula",
            "NGC 7000",
            "Caldwell 20 North America Nebula",
        ],
        "Nebulosa Nord America / NGC 7000",
    ),
]

HEADERS = {
    "User-Agent": "AstroPons-MediaPack/1.0"
}


def fetch_json(url):
    request = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(request, timeout=45) as response:
        return json.loads(response.read().decode("utf-8"))


def download_file(url, destination):
    request = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(request, timeout=90) as response:
        destination.write_bytes(response.read())


def make_search_url(query):
    params = urllib.parse.urlencode(
        {
            "q": query,
            "media_type": "image",
            "page_size": "25",
        }
    )
    return "https://images-api.nasa.gov/search?" + params


def make_asset_url(nasa_id):
    return "https://images-api.nasa.gov/asset/" + urllib.parse.quote(nasa_id)


def score_item(item, file_name, query):
    data_list = item.get("data", [])
    if not data_list:
        return -9999

    data = data_list[0]

    if data.get("media_type") != "image":
        return -9999

    nasa_id = data.get("nasa_id")
    if not nasa_id:
        return -9999

    title = str(data.get("title", "")).lower()
    description = str(data.get("description", "")).lower()
    short_name = file_name.replace(".jpg", "").lower()
    words = query.lower().split()

    score = 0

    for word in words:
        if word in title:
            score += 12
        if word in description:
            score += 2

    if short_name in title:
        score += 40

    if short_name in description:
        score += 10

    if "hubble" in title:
        score += 12

    if "hubble" in description:
        score += 6

    bad_words = ["artist", "illustration", "simulation", "diagram"]
    for bad in bad_words:
        if bad in title:
            score -= 30
        if bad in description:
            score -= 12

    return score


def pick_best_href(asset_json):
    items = asset_json.get("collection", {}).get("items", [])
    candidates = []

    for item in items:
        href = item.get("href")
        if not isinstance(href, str):
            continue

        low = href.lower()

        if ".jpg" not in low and ".jpeg" not in low and ".png" not in low:
            continue

        score = 0

        if "~medium" in low:
            score += 100
        if "~large" in low:
            score += 90
        if "~orig" in low:
            score += 65
        if "~small" in low:
            score += 25
        if "~thumb" in low:
            score -= 50
        if ".jpg" in low:
            score += 10
        if ".jpeg" in low:
            score += 8
        if ".png" in low:
            score += 2

        candidates.append((score, href))

    if not candidates:
        return None

    candidates.sort(reverse=True)
    return candidates[0][1]


def find_image(file_name, queries):
    for query in queries:
        print("  trying query:", query)

        search_url = make_search_url(query)
        search_json = fetch_json(search_url)
        items = search_json.get("collection", {}).get("items", [])

        ranked = []

        for item in items:
            score = score_item(item, file_name, query)
            if score > -9999:
                ranked.append((score, item, query, search_url))

        ranked.sort(reverse=True, key=lambda row: row[0])

        for score, item, used_query, used_search_url in ranked[:8]:
            data = item.get("data", [{}])[0]
            nasa_id = data.get("nasa_id")

            if not nasa_id:
                continue

            try:
                asset_url = make_asset_url(nasa_id)
                asset_json = fetch_json(asset_url)
                href = pick_best_href(asset_json)

                if href:
                    return {
                        "href": href,
                        "nasa_id": nasa_id,
                        "title": data.get("title", ""),
                        "search_url": used_search_url,
                        "asset_url": asset_url,
                        "query": used_query,
                    }

            except Exception as error:
                print("  asset failed for", nasa_id, "-", error)

    return None


def main():
    credits = [
        "# Astro Pons - Object Media Credits",
        "",
        "Images downloaded from NASA Image and Video Library API.",
        "Review every image manually before public release.",
        "",
    ]

    downloaded = 0
    failed = 0
    skipped = 0

    for file_name, queries, label in TARGETS:
        destination = OUT_DIR / file_name

        if destination.exists():
            print("SKIP", file_name, "already exists")
            credits.append("- " + file_name + " - existing local file; not overwritten.")
            skipped += 1
            continue

        print("SEARCH", label)

        try:
            image = find_image(file_name, queries)

            if not image:
                print("FAIL", file_name, "- no image found")
                credits.append("- " + file_name + " - NOT DOWNLOADED. Queries: " + ", ".join(queries))
                failed += 1
                continue

            print("  NASA ID:", image["nasa_id"])
            print("  Title:", image["title"])
            print("  Downloading ->", destination)

            download_file(image["href"], destination)

            credits.extend(
                [
                    "- " + file_name + " - " + label,
                    "  - NASA ID: " + str(image["nasa_id"]),
                    "  - Title: " + str(image["title"]),
                    "  - Search: " + str(image["search_url"]),
                    "  - Asset: " + str(image["asset_url"]),
                    "  - Downloaded file: " + str(image["href"]),
                    "",
                ]
            )

            downloaded += 1

        except Exception as error:
            print("FAIL", file_name, "-", error)
            credits.append("- " + file_name + " - ERROR: " + str(error))
            failed += 1

    credits_path = OUT_DIR / "credits.md"
    credits_path.write_text("\n".join(credits), encoding="utf-8")

    print("")
    print("Done.")
    print("Downloaded:", downloaded)
    print("Skipped:   ", skipped)
    print("Failed:    ", failed)
    print("Credits:   ", credits_path)


if __name__ == "__main__":
    main()