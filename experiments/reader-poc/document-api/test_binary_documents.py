import io
import shutil
import unittest
import zipfile

from binary_documents import DOCX, PDF, PPTX, XLSX, DocumentError, convert_binary

REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
P = "http://schemas.openxmlformats.org/presentationml/2006/main"
A = "http://schemas.openxmlformats.org/drawingml/2006/main"
X = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"


def relationships(rows):
    return '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + "".join(
        f'<Relationship Id="{key}" Type="{REL}/{kind}" Target="{path}" />' for key, kind, path in rows
    ) + '</Relationships>'


def package(parts, main):
    files = dict(parts)
    files['_rels/.rels'] = relationships([('main', 'officeDocument', main)])
    files['[Content_Types].xml'] = (
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '</Types>'
    )
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as archive:
        for name, data in files.items():
            archive.writestr(name, data)
    return buf.getvalue()


def text_pdf():
    stream = b'BT /F1 12 Tf 20 60 Td (Hello AutoFindex) Tj ET'
    objects = [
        b'<< /Type /Catalog /Pages 2 0 R >>',
        b'<< /Type /Pages /Count 1 /Kids [3 0 R] >>',
        b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 80] /Contents 5 0 R /Resources << /Font << /F1 4 0 R >> >> >>',
        b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
        f'<< /Length {len(stream)} >>\nstream\n'.encode() + stream + b'\nendstream',
    ]
    data = bytearray(b'%PDF-1.4\n')
    offsets = []
    for index, obj in enumerate(objects, 1):
        offsets.append(len(data))
        data.extend(f'{index} 0 obj\n'.encode() + obj + b'\nendobj\n')
    xref = len(data)
    data.extend(f'xref\n0 {len(objects)+1}\n0000000000 65535 f \n'.encode())
    for offset in offsets:
        data.extend(f'{offset:010d} 00000 n \n'.encode())
    data.extend(f'trailer\n<< /Size {len(objects)+1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF'.encode())
    return bytes(data)


class BinaryDocumentTests(unittest.TestCase):
    def test_docx_text_and_title(self):
        doc = f'<w:document xmlns:w="{W}"><w:body><w:p><w:r><w:t>Pièce </w:t></w:r><w:r><w:t>auto</w:t></w:r></w:p><w:p><w:r><w:t>Disponible</w:t></w:r></w:p></w:body></w:document>'
        meta = '<cp:coreProperties xmlns:cp="urn:core" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Catalogue</dc:title></cp:coreProperties>'
        raw = package({'word/document.xml': doc, 'docProps/core.xml': meta}, 'word/document.xml')
        self.assertEqual(convert_binary(raw, DOCX), ('Catalogue', 'Pièce auto\nDisponible'))

    def test_xlsx_sheet_order_and_text(self):
        main = f'<workbook xmlns="{X}" xmlns:r="{REL}"><sheets><sheet name="Stock" sheetId="3" r:id="r3"/><sheet name="Détails" sheetId="1" r:id="r1"/></sheets></workbook>'
        sheet1 = f'<worksheet xmlns="{X}"><sheetData><row><c r="A1" t="s"><v>0</v></c><c r="C1"><v>19</v></c></row></sheetData></worksheet>'
        sheet2 = f'<worksheet xmlns="{X}"><sheetData><row><c r="A1" t="inlineStr"><is><t>Dispo</t></is></c><c r="B1" t="b"><v>1</v></c></row></sheetData></worksheet>'
        raw = package({
            'xl/workbook.xml': main,
            'xl/_rels/workbook.xml.rels': relationships([('r1','worksheet','worksheets/sheet1.xml'),('r3','worksheet','/xl/worksheets/sheet3.xml')]),
            'xl/sharedStrings.xml': f'<sst xmlns="{X}"><si><t>Pneu</t></si></sst>',
            'xl/worksheets/sheet3.xml': sheet1, 'xl/worksheets/sheet1.xml': sheet2,
        }, 'xl/workbook.xml')
        self.assertEqual(convert_binary(raw, XLSX), ('', 'Stock\nPneu\t\t19\n\nDétails\nDispo\tTRUE'))

    def test_pptx_slide_order(self):
        main = f'<p:presentation xmlns:p="{P}" xmlns:r="{REL}"><p:sldIdLst><p:sldId id="2" r:id="two"/><p:sldId id="1" r:id="one"/></p:sldIdLst></p:presentation>'
        def slide(text):
            return f'<p:sld xmlns:p="{P}" xmlns:a="{A}"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>{text}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>'
        raw = package({
            'ppt/presentation.xml': main,
            'ppt/_rels/presentation.xml.rels': relationships([('one','slide','slides/slide1.xml'),('two','slide','slides/slide2.xml')]),
            'ppt/slides/slide2.xml': slide('Second fichier'), 'ppt/slides/slide1.xml': slide('Premier fichier'),
        }, 'ppt/presentation.xml')
        self.assertEqual(convert_binary(raw, PPTX), ('', 'Second fichier\n\nPremier fichier'))

    @unittest.skipUnless(shutil.which('pdftotext') and shutil.which('prlimit'), 'PDF converter unavailable')
    def test_pdf(self):
        self.assertEqual(convert_binary(text_pdf(), PDF), ('', 'Hello AutoFindex'))

    def test_invalid_inputs(self):
        for kind in (DOCX, XLSX, PPTX):
            with self.subTest(kind=kind), self.assertRaises(DocumentError) as err:
                convert_binary(b'not a document', kind)
            self.assertEqual(err.exception.status, 422)
        with self.assertRaises(DocumentError) as err:
            convert_binary(b'raw binary', 'application/octet-stream')
        self.assertEqual(err.exception.status, 415)

    def test_reject_dtd_empty_and_oversized_parts(self):
        for xml, status in [
            ('<!DOCTYPE a [<!ENTITY e "content">]><a>&e;</a>', 422),
            (f'<w:document xmlns:w="{W}"><w:body/></w:document>', 422),
            ('<a>' + ('x' * (4 * 1024 * 1024)) + '</a>', 413),
        ]:
            with self.subTest(status=status), self.assertRaises(DocumentError) as err:
                convert_binary(package({'word/document.xml': xml}, 'word/document.xml'), DOCX)
            self.assertEqual(err.exception.status, status)


if __name__ == "__main__":
    unittest.main()
