/**
 * File Generator - Phase 6
 * Generates various file types (txt, html, xml, json, csv, md, docx, xlsx, pdf)
 * and triggers downloads via Chrome API
 */

import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
} from 'docx';
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import type { FileGenerationType, FileContent } from '../shared/types';
import { FILE_GENERATION_CONFIG, debugLog, debugError } from '../shared/constants';

/**
 * File Generator class - handles all file generation and downloads
 */
class FileGenerator {
  /**
   * Generate a file and trigger download
   */
  async generateAndDownload(
    fileType: FileGenerationType,
    filename: string,
    content: FileContent
  ): Promise<{ success: boolean; downloadId?: number; error?: string }> {
    try {
      // Validate inputs
      this.validateInputs(fileType, filename, content);

      // Ensure filename has correct extension
      const finalFilename = this.ensureExtension(filename, fileType);

      debugLog('FileGenerator', 'Generating file', { fileType, filename: finalFilename });

      // Generate file based on type
      let blob: Blob;
      let mimeType: string;

      if (FILE_GENERATION_CONFIG.TEXT_BASED_TYPES.includes(fileType as any)) {
        const result = this.generateTextFile(fileType, content);
        blob = result.blob;
        mimeType = result.mimeType;
      } else {
        // Binary types
        switch (fileType) {
          case 'docx':
            blob = await this.generateDocx(content);
            mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
            break;
          case 'xlsx':
            blob = this.generateXlsx(content);
            mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
            break;
          case 'pdf':
            blob = this.generatePdf(content);
            mimeType = 'application/pdf';
            break;
          default:
            throw new Error(`Unsupported file type: ${fileType}`);
        }
      }

      // Convert blob to data URL for Chrome download API
      const dataUrl = await this.blobToDataUrl(blob);

      // Trigger download
      const downloadId = await this.downloadFile(dataUrl, finalFilename, mimeType);

      debugLog('FileGenerator', 'File generated and download started', {
        downloadId,
        filename: finalFilename,
        size: blob.size,
      });

      return { success: true, downloadId };
    } catch (error) {
      // M6 Fix: Preserve full error context
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorStack = error instanceof Error ? error.stack : undefined;
      debugError('FileGenerator', 'File generation failed', { message: errorMessage, stack: errorStack, error });
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Validate inputs
   */
  private validateInputs(
    fileType: FileGenerationType,
    filename: string,
    content: FileContent
  ): void {
    if (!filename || filename.length > FILE_GENERATION_CONFIG.MAX_FILENAME_LENGTH) {
      throw new Error(`Invalid filename: must be 1-${FILE_GENERATION_CONFIG.MAX_FILENAME_LENGTH} characters`);
    }

    // Check for invalid filename characters
    const invalidChars = /[<>:"/\\|?*\x00-\x1f]/;
    if (invalidChars.test(filename)) {
      throw new Error('Filename contains invalid characters');
    }

    // Validate content based on file type
    if (FILE_GENERATION_CONFIG.TEXT_BASED_TYPES.includes(fileType as any)) {
      if (!content.text) {
        throw new Error(`Text content required for ${fileType} files`);
      }
      if (content.text.length > FILE_GENERATION_CONFIG.MAX_CONTENT_LENGTH) {
        throw new Error(`Content exceeds maximum size of ${FILE_GENERATION_CONFIG.MAX_CONTENT_LENGTH} bytes`);
      }
    } else if (fileType === 'docx' && !content.document && !content.text) {
      throw new Error('Document content or text required for DOCX files');
    } else if (fileType === 'xlsx' && !content.spreadsheet && !content.text) {
      throw new Error('Spreadsheet content or text required for XLSX files');
    } else if (fileType === 'pdf' && !content.pdf && !content.text) {
      throw new Error('PDF content or text required for PDF files');
    }
  }

  /**
   * Ensure filename has correct extension
   */
  private ensureExtension(filename: string, fileType: FileGenerationType): string {
    const extension = `.${fileType}`;
    if (filename.toLowerCase().endsWith(extension)) {
      return filename;
    }
    return `${filename}${extension}`;
  }

  /**
   * Generate text-based files (txt, html, xml, json, csv, md)
   */
  private generateTextFile(
    fileType: FileGenerationType,
    content: FileContent
  ): { blob: Blob; mimeType: string } {
    const text = content.text || '';
    let mimeType: string;

    switch (fileType) {
      case 'txt':
        mimeType = 'text/plain';
        break;
      case 'html':
        mimeType = 'text/html';
        break;
      case 'xml':
        mimeType = 'application/xml';
        break;
      case 'json':
        mimeType = 'application/json';
        break;
      case 'csv':
        mimeType = 'text/csv';
        break;
      case 'md':
        mimeType = 'text/markdown';
        break;
      default:
        mimeType = 'text/plain';
    }

    return {
      blob: new Blob([text], { type: mimeType }),
      mimeType,
    };
  }

  /**
   * Generate DOCX file
   */
  private async generateDocx(content: FileContent): Promise<Blob> {
    const children: Paragraph[] = [];
    const { DOCX_DEFAULTS } = FILE_GENERATION_CONFIG;

    // If simple text provided, create simple document
    if (content.text && !content.document) {
      const paragraphs = content.text.split('\n').filter(p => p.trim());
      for (const para of paragraphs) {
        children.push(
          new Paragraph({
            children: [new TextRun({ text: para, size: DOCX_DEFAULTS.fontSize })],
          })
        );
      }
    } else if (content.document) {
      // Add title if provided
      if (content.document.title) {
        children.push(
          new Paragraph({
            children: [
              new TextRun({
                text: content.document.title,
                bold: true,
                size: DOCX_DEFAULTS.headingFontSize,
              }),
            ],
            heading: HeadingLevel.HEADING_1,
          })
        );
      }

      // Add paragraphs
      if (content.document.paragraphs) {
        for (const para of content.document.paragraphs) {
          let heading: (typeof HeadingLevel)[keyof typeof HeadingLevel] | undefined;
          if (para.heading === 'h1') heading = HeadingLevel.HEADING_1;
          else if (para.heading === 'h2') heading = HeadingLevel.HEADING_2;
          else if (para.heading === 'h3') heading = HeadingLevel.HEADING_3;

          children.push(
            new Paragraph({
              children: [
                new TextRun({
                  text: para.text,
                  bold: para.bold || !!para.heading,
                  italics: para.italic,
                  size: para.heading ? DOCX_DEFAULTS.headingFontSize : DOCX_DEFAULTS.fontSize,
                }),
              ],
              heading,
            })
          );
        }
      }

      // Add tables
      if (content.document.tables) {
        for (const tableData of content.document.tables) {
          const rows: TableRow[] = [];

          // Header row
          if (tableData.headers && tableData.headers.length > 0) {
            rows.push(
              new TableRow({
                children: tableData.headers.map(
                  header =>
                    new TableCell({
                      children: [
                        new Paragraph({
                          children: [new TextRun({ text: header, bold: true })],
                        }),
                      ],
                      width: { size: 100 / tableData.headers.length, type: WidthType.PERCENTAGE },
                    })
                ),
              })
            );
          }

          // Data rows
          for (const rowData of tableData.rows) {
            rows.push(
              new TableRow({
                children: rowData.map(
                  cell =>
                    new TableCell({
                      children: [new Paragraph({ children: [new TextRun(cell)] })],
                    })
                ),
              })
            );
          }

          children.push(new Paragraph({ children: [] })); // Spacer
          const table = new Table({ rows });
          children.push(table as any); // TypeScript workaround
        }
      }
    }

    const doc = new Document({
      sections: [{ children }],
    });

    return await Packer.toBlob(doc);
  }

  /**
   * Generate XLSX file
   */
  private generateXlsx(content: FileContent): Blob {
    const { XLSX_DEFAULTS } = FILE_GENERATION_CONFIG;

    let data: (string | number)[][] = [];
    let sheetName: string = XLSX_DEFAULTS.defaultSheetName;

    // If simple text (CSV-like), parse it
    if (content.text && !content.spreadsheet) {
      const lines = content.text.split('\n').filter(l => l.trim());
      data = lines.map(line =>
        line.split(/[,\t]/).map(cell => {
          const trimmed = cell.trim();
          const num = Number(trimmed);
          return isNaN(num) ? trimmed : num;
        })
      );
    } else if (content.spreadsheet) {
      sheetName = content.spreadsheet.sheetName || XLSX_DEFAULTS.defaultSheetName;

      // Add headers
      if (content.spreadsheet.headers) {
        data.push(content.spreadsheet.headers);
      }

      // Add rows
      if (content.spreadsheet.rows) {
        data.push(...content.spreadsheet.rows);
      }
    }

    // Create workbook
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(data);

    // Set column widths (guard against empty data)
    const maxCols = data.length > 0 ? Math.max(...data.map(row => row.length)) : 0;
    if (maxCols > 0) {
      ws['!cols'] = Array(maxCols).fill({ wch: XLSX_DEFAULTS.columnWidth });
    }

    XLSX.utils.book_append_sheet(wb, ws, sheetName);

    // Generate buffer
    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });

    return new Blob([wbout], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
  }

  /**
   * Generate PDF file
   */
  private generatePdf(content: FileContent): Blob {
    const { PDF_DEFAULTS } = FILE_GENERATION_CONFIG;
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'pt',
      format: PDF_DEFAULTS.pageSize.toLowerCase() as any,
    });

    let yPosition = PDF_DEFAULTS.margin;
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const contentWidth = pageWidth - 2 * PDF_DEFAULTS.margin;

    // Helper to add new page if needed
    const checkPageBreak = (height: number) => {
      if (yPosition + height > pageHeight - PDF_DEFAULTS.margin) {
        doc.addPage();
        yPosition = PDF_DEFAULTS.margin;
      }
    };

    // If simple text provided
    if (content.text && !content.pdf) {
      doc.setFontSize(PDF_DEFAULTS.fontSize);
      const lines = doc.splitTextToSize(content.text, contentWidth);
      for (const line of lines) {
        checkPageBreak(PDF_DEFAULTS.fontSize + 4);
        doc.text(line, PDF_DEFAULTS.margin, yPosition);
        yPosition += PDF_DEFAULTS.fontSize + 4;
      }
    } else if (content.pdf) {
      // Add title
      if (content.pdf.title) {
        doc.setFontSize(PDF_DEFAULTS.headingFontSize + 6);
        doc.setFont('helvetica', 'bold');
        checkPageBreak(PDF_DEFAULTS.headingFontSize + 10);
        doc.text(content.pdf.title, PDF_DEFAULTS.margin, yPosition);
        yPosition += PDF_DEFAULTS.headingFontSize + 20;
      }

      // Add content
      for (const item of content.pdf.content) {
        if (item.type === 'heading') {
          const fontSize =
            PDF_DEFAULTS.headingFontSize - (item.level ? (item.level - 1) * 3 : 0);
          doc.setFontSize(fontSize);
          doc.setFont('helvetica', 'bold');
          checkPageBreak(fontSize + 10);
          doc.text(item.text || '', PDF_DEFAULTS.margin, yPosition);
          yPosition += fontSize + 10;
        } else if (item.type === 'text') {
          doc.setFontSize(PDF_DEFAULTS.fontSize);
          doc.setFont('helvetica', 'normal');
          const lines = doc.splitTextToSize(item.text || '', contentWidth);
          for (const line of lines) {
            checkPageBreak(PDF_DEFAULTS.fontSize + 4);
            doc.text(line, PDF_DEFAULTS.margin, yPosition);
            yPosition += PDF_DEFAULTS.fontSize + 4;
          }
          yPosition += 8; // Extra spacing after paragraph
        } else if (item.type === 'table' && item.tableData) {
          // Simple table rendering
          const { headers, rows } = item.tableData;
          const colCount = headers.length;
          const colWidth = contentWidth / colCount;
          const rowHeight = PDF_DEFAULTS.fontSize + 8;

          // Headers
          doc.setFontSize(PDF_DEFAULTS.fontSize);
          doc.setFont('helvetica', 'bold');
          checkPageBreak(rowHeight * (rows.length + 1));

          for (let i = 0; i < headers.length; i++) {
            doc.text(
              headers[i].substring(0, 20),
              PDF_DEFAULTS.margin + i * colWidth + 4,
              yPosition
            );
          }
          yPosition += rowHeight;

          // Draw header line
          doc.line(
            PDF_DEFAULTS.margin,
            yPosition - rowHeight + 2,
            pageWidth - PDF_DEFAULTS.margin,
            yPosition - rowHeight + 2
          );

          // Data rows
          doc.setFont('helvetica', 'normal');
          for (const row of rows) {
            checkPageBreak(rowHeight);
            for (let i = 0; i < row.length; i++) {
              doc.text(
                String(row[i]).substring(0, 20),
                PDF_DEFAULTS.margin + i * colWidth + 4,
                yPosition
              );
            }
            yPosition += rowHeight;
          }
          yPosition += 10;
        }
      }
    }

    return doc.output('blob');
  }

  /**
   * Convert Blob to Data URL
   */
  private blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        if (typeof reader.result === 'string') {
          resolve(reader.result);
        } else {
          reject(new Error('Failed to convert blob to data URL'));
        }
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  /**
   * Trigger file download using Chrome API
   */
  private async downloadFile(
    dataUrl: string,
    filename: string,
    _mimeType: string
  ): Promise<number> {
    const downloadPath = FILE_GENERATION_CONFIG.DOWNLOAD_FOLDER
      ? `${FILE_GENERATION_CONFIG.DOWNLOAD_FOLDER}/${filename}`
      : filename;

    const downloadId = await chrome.downloads.download({
      url: dataUrl,
      filename: downloadPath,
      saveAs: FILE_GENERATION_CONFIG.PROMPT_FOR_LOCATION,
    });

    return downloadId;
  }
}

// Export singleton instance
export const fileGenerator = new FileGenerator();
