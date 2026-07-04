#!/usr/bin/env node

import PDFDocument from 'pdfkit'
import { createWriteStream } from 'node:fs'
import { mkdir, readFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import process from 'node:process'
import { paths } from './lib/project.js'

function stripInline (text) {
  return text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/_(.+?)_/g, '$1')
    .replace(/`(.+?)`/g, '$1')
    .trim()
}

function addFooter (doc, pageNumber) {
  const oldY = doc.y
  const oldBottomMargin = doc.page.margins.bottom
  doc.page.margins.bottom = 0
  doc.font('Helvetica')
    .fontSize(8)
    .fillColor('#64748B')
    .text(
      `Finance Video Brief  |  Page ${pageNumber}`,
      54,
      doc.page.height - 36,
      { align: 'center', width: doc.page.width - 108, lineBreak: false }
    )
  doc.page.margins.bottom = oldBottomMargin
  doc.y = oldY
}

async function makePdf (input, output) {
  const markdown = await readFile(input, 'utf8')
  await mkdir(dirname(output), { recursive: true })

  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 46, right: 48, bottom: 52, left: 48 },
    bufferPages: true,
    info: { Title: basename(input), Author: 'Finance Video' }
  })
  doc.pipe(createWriteStream(output))

  const lines = markdown.split(/\r?\n/)
  let firstTitle = true

  for (const raw of lines) {
    const line = raw.trim()
    if (!line || line === '---') {
      doc.moveDown(0.35)
      continue
    }

    if (line.startsWith('# ')) {
      doc.font('Helvetica-Bold')
        .fontSize(firstTitle ? 20 : 15)
        .fillColor('#102A43')
        .text(stripInline(line.slice(2)), { align: firstTitle ? 'center' : 'left' })
      doc.moveDown(firstTitle ? 0.6 : 0.25)
      firstTitle = false
      continue
    }

    if (line.startsWith('## ')) {
      doc.moveDown(0.45)
      doc.font('Helvetica-Bold')
        .fontSize(13)
        .fillColor('#0F766E')
        .text(stripInline(line.slice(3)), { keepTogether: true })
      doc.moveDown(0.15)
      continue
    }

    if (line.startsWith('### ')) {
      doc.moveDown(0.25)
      doc.font('Helvetica-Bold')
        .fontSize(10.8)
        .fillColor('#334E68')
        .text(stripInline(line.slice(4)), { keepTogether: true })
      doc.moveDown(0.08)
      continue
    }

    if (/^[-*]\s+/.test(line) || /^\d+\.\s+/.test(line)) {
      const text = stripInline(line.replace(/^([-*]|\d+\.)\s+/, ''))
      doc.font('Helvetica')
        .fontSize(9.6)
        .fillColor('#243B53')
        .text(`-  ${text}`, { indent: 8, paragraphGap: 3, lineGap: 1 })
      continue
    }

    if (line.startsWith('> ')) {
      doc.font('Helvetica-Oblique')
        .fontSize(9.2)
        .fillColor('#475569')
        .text(stripInline(line.slice(2)), {
          indent: 10,
          paragraphGap: 5,
          lineGap: 1
        })
      continue
    }

    doc.font('Helvetica')
      .fontSize(9.6)
      .fillColor('#243B53')
      .text(stripInline(line), { paragraphGap: 4, lineGap: 1 })
  }

  doc.moveDown(0.8)
  doc.font('Helvetica')
    .fontSize(8)
    .fillColor('#64748B')
    .text(
      'Educational summary based on supplied video transcripts. Not personalized financial advice.',
      { align: 'center' }
    )

  const range = doc.bufferedPageRange()
  for (let index = range.start; index < range.start + range.count; index += 1) {
    doc.switchToPage(index)
    addFooter(doc, index - range.start + 1)
  }
  doc.end()

  await new Promise((resolvePromise, reject) => {
    doc.on('end', resolvePromise)
    doc.on('error', reject)
  })
}

const input = process.argv[2]
if (!input) {
  console.error('Usage: node ./src/make_report.js <raport.md> [output.pdf]')
  process.exit(1)
}
const inputPath = resolve(input)
const outputPath = resolve(process.argv[3] || resolve(paths.pdfRaports, `${basename(input, '.md')}.pdf`))
await makePdf(inputPath, outputPath)
console.log(outputPath)
