"""Build a private, reproducible local teaching pack from case and article ZIPs.

Requires python-docx, pdfplumber, and Pillow. Original files and extracted text
stay outside public/ and must not be committed. No model/network calls occur.
"""
import argparse
import hashlib
import io
import json
import logging
from pathlib import Path, PurePosixPath
import re
import sys
import uuid
import zipfile

from docx import Document
import pdfplumber
from PIL import Image

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from draft_clinical_content import build_clinical_review, build_draft_phases, build_draft_review

logging.getLogger('pdfminer').setLevel(logging.ERROR)
NAMESPACE = uuid.UUID('4c8740eb-bbc0-4198-8bc7-c35b5ba42e0c')
MAX_ARCHIVE_BYTES = 250 * 1024 * 1024


def identity(value):
    return str(uuid.uuid5(NAMESPACE, value))


def digest(data):
    return hashlib.sha256(data).hexdigest()


def entries(path, extensions):
    with zipfile.ZipFile(path) as archive:
        if sum(e.file_size for e in archive.infolist()) > MAX_ARCHIVE_BYTES:
            raise ValueError('Archive exceeds 250 MB uncompressed limit')
        result = {}
        for entry in archive.infolist():
            name = PurePosixPath(entry.filename)
            if name.is_absolute() or '..' in name.parts or chr(92) in entry.orig_filename or ':' in entry.orig_filename:
                raise ValueError('Unsafe archive path')
            if entry.is_dir() or '__MACOSX' in name.parts or any(p.startswith('.') for p in name.parts):
                continue
            if name.suffix.lower() not in extensions:
                continue
            if str(name) in result:
                raise ValueError('Duplicate archive entry')
            result[str(name)] = archive.read(entry)
        return result


def docx_sections(data):
    paragraphs = [p.text.strip() for p in Document(io.BytesIO(data)).paragraphs if p.text.strip()]
    intro = next((i for i, p in enumerate(paragraphs) if p.startswith('Information to be presented to the student:')), None)
    notes = next((i for i, p in enumerate(paragraphs) if p.startswith('Summary of the case')), None)
    if intro is None or notes is None or notes <= intro:
        raise ValueError('Case description must clearly separate student introduction and expert summary')
    description = '\n'.join(paragraphs[intro + 1:notes])
    background = '\n'.join(paragraphs[notes + 1:])
    if not description or not background or len(description) > 1500 or len(background) > 6000:
        raise ValueError('Empty or oversized case sections; review before importing')
    return description, background


def phases(case_id):
    return build_draft_phases(case_id, identity)


def build(cases_zip, articles_zip, output):
    output = output.resolve()
    # Private source material must never become a Next.js public asset.
    repo = Path(__file__).resolve().parents[1]
    if output == repo or repo / 'public' == output or repo / 'public' in output.parents:
        raise ValueError('Choose a private output directory, e.g. work/teaching-materials')
    case_files = entries(cases_zip, {'.docx', '.png', '.jpg', '.jpeg'})
    article_files = entries(articles_zip, {'.pdf'})
    if not case_files or not article_files:
        raise ValueError('Both archives must contain the expected documents')
    package_id = digest(Path(cases_zip).read_bytes() + Path(articles_zip).read_bytes())
    cases, media, articles = [], [], []
    source_bytes = 0
    converted_bytes = 0
    # Validate and prepare everything before writing a usable manifest.
    images = {}
    for name, data in sorted(case_files.items()):
        if not name.lower().endswith('.docx'):
            continue
        description, background = docx_sections(data)
        folder = str(PurePosixPath(name).parent)
        label = PurePosixPath(folder).name
        case_id = identity(package_id + ':' + folder)
        attachments = []
        image_files = [(n, d) for n, d in case_files.items() if str(PurePosixPath(n).parent) == folder and PurePosixPath(n).suffix.lower() != '.docx']
        image_files.sort(key=lambda pair: ('(OPG)' not in pair[0], pair[0]))
        for image_name, image_data in image_files:
            media_id = identity(package_id + ':' + image_name)
            with Image.open(io.BytesIO(image_data)) as image:
                if image.width * image.height > 40_000_000:
                    raise ValueError('Oversized teaching image')
                # Keep the original pixel dimensions and use lossless WebP;
                # no cropping, recolouring or diagnostic image alteration.
                clean = image.convert('RGB')
                buffer = io.BytesIO()
                clean.save(buffer, format='WEBP', lossless=True, method=6, exif=b'')
                converted = buffer.getvalue()
                width, height = clean.size
            file = f'media/{media_id}.webp'
            images[file] = converted
            source_bytes += len(image_data)
            converted_bytes += len(converted)
            media.append(dict(id=media_id, caseId=case_id, file=file, mimeType='image/webp', sha256=digest(converted), width=width, height=height))
            title = PurePosixPath(image_name).stem.removeprefix(label + ' ')
            attachments.append(dict(id=media_id, kind='image', title=title,
                description=f'{label}: {title}. Review this record before drawing conclusions.',
                url=f'/api/materials/{media_id}', sourceLabel=f'Provided teaching records - {label}'))
        if not attachments or not any('(OPG)' in a['title'] for a in attachments):
            raise ValueError('Every case must include its own OPG')
        clinical_case = dict(id=case_id, title=f'{label} - Canine assessment', description=description,
            # The local pack loader intentionally exposes imported cases as
            # available for private testing, but the source manifest remains a
            # draft and is accompanied by an explicit clinician-review sidecar.
            difficulty='advanced', status='draft', learningObjectives=[
                'Describe and localise findings using the supplied records.',
                'Assess adjacent root risk and justify a provisional plan.',
                'Evaluate published evidence with its limitations.',
            ], phases=phases(case_id), sourceCaseId=None, version=1, publishedAt=None,
            attachments=attachments, isTestFixture=False)
        cases.append(dict(case=clinical_case, expertNotes=background, sourceDocument=PurePosixPath(name).name))
    if not cases:
        raise ValueError('No case descriptions found')
    for name, data in sorted(article_files.items()):
        filename = PurePosixPath(name).name
        with pdfplumber.open(io.BytesIO(data)) as pdf:
            # PDF text flow follows the source content stream and avoids
            # merging left/right columns into contradictory sentences.
            pages = [dict(page=i, text=re.sub(r'(?<=\w)-\s*\n(?=\w)', '',
                         (page.extract_text(x_tolerance=2, use_text_flow=True) or '')).strip())
                     for i, page in enumerate(pdf.pages, 1)]
        if sum(len(p['text']) for p in pages) < 100:
            raise ValueError(f'PDF needs OCR before import: {filename}')
        articles.append(dict(id=identity(digest(data)), title=re.sub(r'^\d+\.\s*', '', PurePosixPath(filename).stem),
            filename=filename, sha256=digest(data), pages=pages))
    clinical_review = build_clinical_review(cases)
    manifest = dict(formatVersion=1, packageId=package_id, cases=cases, articles=articles, media=media,
                    clinicalReview=clinical_review)
    draft_review = build_draft_review(package_id, [
        {
            'caseId': item['case']['id'],
            'sourceDocument': item['sourceDocument'],
            'phaseCount': len(item['case']['phases']),
            'criterionIds': [
                criterion['id']
                for phase in item['case']['phases']
                for criterion in phase['rubric']
            ],
        }
        for item in cases
    ])
    draft_review['contentSha256'] = clinical_review['contentSha256']
    (output / 'media').mkdir(parents=True, exist_ok=True)
    for filename, data in images.items():
        (output / filename).write_bytes(data)
    temporary = output / 'manifest.tmp'
    temporary.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    temporary.replace(output / 'manifest.json')
    (output / 'draft-review.json').write_text(json.dumps(draft_review, ensure_ascii=False, indent=2), encoding='utf-8')
    report = dict(cases=len(cases), images=len(media), articles=len(articles), pages=sum(len(a['pages']) for a in articles),
                  sourceImageBytes=source_bytes, losslessImageBytes=converted_bytes,
                  textCharacters=sum(len(p['text']) for a in articles for p in a['pages']),
                  packageId=package_id, output=str(output), draftReviewStatus=draft_review['status'])
    (output / 'import-report.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cases', type=Path, required=True)
    parser.add_argument('--articles', type=Path, required=True)
    parser.add_argument('--output', type=Path, default=Path('work/teaching-materials'))
    args = parser.parse_args()
    build(args.cases, args.articles, args.output)
