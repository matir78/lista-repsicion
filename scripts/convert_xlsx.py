#!/usr/bin/env python3
"""Convert the observed restock XLSX format to a validated local JSON catalog."""

import argparse
import hashlib
import json
import os
import posixpath
import re
import tempfile
import unicodedata
import zipfile
import xml.etree.ElementTree as ET
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
DOC_REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PACKAGE_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
REQUIRED_HEADERS = {
    "cod.articulo": "articleCode",
    "articulo": "description",
    "cod.barra": "barcode",
}


def normalize_label(value):
    normalized = unicodedata.normalize("NFKD", str(value).strip().lower())
    return "".join(character for character in normalized if not unicodedata.combining(character))


def xml_text(element):
    return "".join(node.text or "" for node in element.iter(f"{{{MAIN_NS}}}t"))


def read_shared_strings(archive):
    path = "xl/sharedStrings.xml"
    if path not in archive.namelist():
        return []
    root = ET.fromstring(archive.read(path))
    return [xml_text(item) for item in root.findall(f"{{{MAIN_NS}}}si")]


def workbook_sheets(archive):
    workbook = ET.fromstring(archive.read("xl/workbook.xml"))
    relationships = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
    targets = {
        relation.attrib["Id"]: relation.attrib["Target"]
        for relation in relationships.findall(f"{{{PACKAGE_REL_NS}}}Relationship")
    }
    sheets = []
    for sheet in workbook.findall(f".//{{{MAIN_NS}}}sheet"):
        relation_id = sheet.attrib[f"{{{DOC_REL_NS}}}id"]
        target = targets[relation_id].lstrip("/")
        path = target if target.startswith("xl/") else posixpath.normpath(f"xl/{target}")
        sheets.append((sheet.attrib["name"], path))
    return sheets


def cell_column(reference):
    match = re.match(r"[A-Z]+", reference)
    return match.group(0) if match else ""


def cell_value(cell, shared_strings):
    cell_type = cell.attrib.get("t", "")
    if cell_type == "inlineStr":
        inline = cell.find(f"{{{MAIN_NS}}}is")
        return xml_text(inline) if inline is not None else ""
    value = cell.find(f"{{{MAIN_NS}}}v")
    if value is None:
        return ""
    raw = value.text or ""
    if cell_type == "s" and raw:
        return shared_strings[int(raw)]
    if cell_type == "b":
        return raw == "1"
    return raw


def read_rows(archive, sheet_path, shared_strings):
    root = ET.fromstring(archive.read(sheet_path))
    for row in root.findall(f".//{{{MAIN_NS}}}sheetData/{{{MAIN_NS}}}row"):
        yield int(row.attrib["r"]), {
            cell_column(cell.attrib.get("r", "")): cell_value(cell, shared_strings)
            for cell in row.findall(f"{{{MAIN_NS}}}c")
        }


def duplicate_summary(products, key):
    counts = Counter(product[key] for product in products if product[key])
    duplicates = sorted(value for value, count in counts.items() if count > 1)
    return {"count": len(duplicates), "sample": duplicates[:10]}


def convert(source):
    with zipfile.ZipFile(source) as archive:
        shared_strings = read_shared_strings(archive)
        sheets = workbook_sheets(archive)
        if not sheets:
            raise ValueError("The workbook has no sheets")
        sheet_name, sheet_path = sheets[0]
        rows = list(read_rows(archive, sheet_path, shared_strings))

    header_index = None
    columns = {}
    for index, (_, row) in enumerate(rows):
        labels = {normalize_label(value): column for column, value in row.items() if value != ""}
        if set(REQUIRED_HEADERS).issubset(labels):
            header_index = index
            columns = {field: labels[label] for label, field in REQUIRED_HEADERS.items()}
            break
    if header_index is None:
        raise ValueError(f"Required headers not found: {', '.join(REQUIRED_HEADERS)}")

    parameter_index = next(
        (
            index
            for index, (_, row) in enumerate(rows[header_index + 1 :], header_index + 1)
            if any(normalize_label(value) == "parametros" for value in row.values())
        ),
        len(rows),
    )
    products = []
    skipped_rows = []
    source_rows = rows[header_index + 1 : parameter_index]
    for row_number, row in source_rows:
        values = {field: row.get(column, "") for field, column in columns.items()}
        if not any(value != "" for value in values.values()):
            continue
        article_code = str(values["articleCode"]).strip()
        description = str(values["description"]).strip()
        if not article_code or not description:
            skipped_rows.append(row_number)
            continue
        products.append(
            {
                "articleCode": article_code,
                "description": description,
                "barcode": str(values["barcode"]).strip() or None,
            }
        )

    source_hash = hashlib.sha256(source.read_bytes()).hexdigest()
    result = {
        "meta": {
            "schemaVersion": 1,
            "source": source.name,
            "sourceSha256": source_hash,
            "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "sheet": sheet_name,
            "headerRow": rows[header_index][0],
            "firstDataRow": source_rows[0][0] if source_rows else None,
            "lastDataRow": source_rows[-1][0] if source_rows else None,
            "sourceRows": len(source_rows),
            "totalRecords": len(products),
            "skippedRows": skipped_rows,
            "duplicateArticleCodes": duplicate_summary(products, "articleCode"),
            "duplicateBarcodes": duplicate_summary(products, "barcode"),
        },
        "products": products,
    }
    validate(result)
    return result


def validate(catalog):
    products = catalog.get("products")
    if not isinstance(products, list) or not products:
        raise ValueError("Catalog must contain at least one product")
    if catalog["meta"]["totalRecords"] != len(products):
        raise ValueError("Catalog record count does not match metadata")
    for index, product in enumerate(products):
        if not isinstance(product.get("articleCode"), str) or not product["articleCode"]:
            raise ValueError(f"Product {index} has no text articleCode")
        if not isinstance(product.get("description"), str) or not product["description"]:
            raise ValueError(f"Product {index} has no description")
        if product.get("barcode") is not None and not isinstance(product["barcode"], str):
            raise ValueError(f"Product {index} has a non-text barcode")


def atomic_write_json(destination, catalog):
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = None
    try:
        with tempfile.NamedTemporaryFile(
            "w", encoding="utf-8", dir=destination.parent, delete=False, suffix=".tmp"
        ) as temporary:
            json.dump(catalog, temporary, ensure_ascii=False, separators=(",", ":"))
            temporary.write("\n")
            temporary_path = Path(temporary.name)
        with temporary_path.open(encoding="utf-8") as generated:
            validate(json.load(generated))
        os.replace(temporary_path, destination)
    finally:
        if temporary_path and temporary_path.exists():
            temporary_path.unlink()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("destination", type=Path)
    args = parser.parse_args()
    if not args.source.is_file():
        parser.error(f"File not found: {args.source}")
    catalog = convert(args.source)
    atomic_write_json(args.destination, catalog)
    print(json.dumps(catalog["meta"], ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
