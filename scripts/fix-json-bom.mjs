import fs from 'fs'
import path from 'path'

function cleanBOMInDir(dir) {
  if (!fs.existsSync(dir)) return
  const files = fs.readdirSync(dir, { recursive: true })
  for (const file of files) {
    const fullPath = path.join(dir, file)
    if (fs.statSync(fullPath).isFile() && fullPath.endsWith('.json')) {
      let content = fs.readFileSync(fullPath, 'utf8')
      if (content.charCodeAt(0) === 0xFEFF || content.startsWith('\uFEFF')) {
        console.log(`[BOM FIX] Removing UTF-8 BOM from: ${fullPath}`)
        content = content.replace(/^\uFEFF/, '')
        fs.writeFileSync(fullPath, content, 'utf8')
      } else {
        console.log(`[OK] No BOM in: ${fullPath}`)
      }
    }
  }
}

console.log('=== FIXING UTF-8 BOM IN ALL JSON FILES ===')
cleanBOMInDir(path.resolve(process.cwd(), 'public'))
cleanBOMInDir(path.resolve(process.cwd(), 'src'))
console.log('=== BOM CLEANUP COMPLETE ===')
