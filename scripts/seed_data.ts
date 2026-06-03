import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'

dotenv.config()

const supabaseUrl = process.env.SUPABASE_URL || ''
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

const supabase = createClient(supabaseUrl, supabaseKey)

// Category IDs from the database inspection:
const SAREE_ROOT_ID = 'ad203466-5991-4ceb-b1d4-ad1de4613387'
const JEWELLERY_ROOT_ID = '4dd49120-3d90-4f8c-9c80-8468e9b2380b'

const SUB_CATEGORIES = [
  // Sarees
  { name: 'Kanjivaram Silk', slug: 'kanjivaram', parent_id: SAREE_ROOT_ID },
  { name: 'Banarasi Brocade', slug: 'banarasi', parent_id: SAREE_ROOT_ID },
  { name: 'Chanderi Cotton', slug: 'chanderi', parent_id: SAREE_ROOT_ID },
  { name: 'Organza Premium', slug: 'organza', parent_id: SAREE_ROOT_ID },
  // Jewellery
  { name: 'Temple Necklaces', slug: 'temple-neck', parent_id: JEWELLERY_ROOT_ID },
  { name: 'Antique Chokers', slug: 'choker', parent_id: JEWELLERY_ROOT_ID },
  { name: 'Traditional Bangles', slug: 'bangles', parent_id: JEWELLERY_ROOT_ID },
  { name: 'Gold Jhumkas', slug: 'jhumkas', parent_id: JEWELLERY_ROOT_ID },
]

const PRODUCTS = [
  // Sarees
  {
    title: 'Crimson Red Kanjivaram Bridal Silk Saree',
    description: 'Woven with pure mulberry silk and authentic gold zari, this crimson red Kanjivaram saree features traditional temple borders and elaborate pallu detailing, perfect for brides.',
    type: 'saree',
    sub_category_slug: 'kanjivaram',
    base_price: 38500,
    discount_pct: 15,
    colors: ['Crimson Red', 'Wedding Maroon'],
    image_url: 'https://images.unsplash.com/photo-1610030469983-98e550d6193c?w=800&auto=format&fit=crop',
  },
  {
    title: 'Midnight Blue Banarasi Brocade Saree',
    description: 'An exquisite handwoven Banarasi saree in midnight blue, featuring intricate floral bootis and a heavy gold brocade border in Katan silk.',
    type: 'saree',
    sub_category_slug: 'banarasi',
    base_price: 24000,
    discount_pct: 0,
    colors: ['Midnight Blue', 'Royal Navy'],
    image_url: 'https://images.unsplash.com/photo-1583391733956-3750e0ff4e8b?w=800&auto=format&fit=crop',
  },
  {
    title: 'Pastel Sage Chanderi Cotton Saree',
    description: 'A lightweight and breathable Chanderi cotton-silk saree in pastel sage green. Crafted with gold hand-blocked buttis and a sheer border, ideal for summer festivities.',
    type: 'saree',
    sub_category_slug: 'chanderi',
    base_price: 6800,
    discount_pct: 10,
    colors: ['Sage Green', 'Mint'],
    image_url: 'https://images.unsplash.com/photo-1608748010899-18f300247112?w=800&auto=format&fit=crop',
  },
  {
    title: 'Peach Blossom Organza Saree',
    description: 'A modern, lightweight organza saree in soft peach with hand-painted floral motifs and delicate scalloped embroidery borders.',
    type: 'saree',
    sub_category_slug: 'organza',
    base_price: 11200,
    discount_pct: 20,
    colors: ['Peach Pink', 'Rosewater'],
    image_url: 'https://images.unsplash.com/photo-1617627143750-d86bc21e42bb?w=800&auto=format&fit=crop',
  },

  // Jewellery
  {
    title: '22k Gold Temple Necklace Set',
    description: 'A majestic 22k gold heritage temple necklace featuring detailed carvings of Goddess Lakshmi, adorned with real rubies, emeralds, and dangling seed pearls.',
    type: 'jewellery',
    sub_category_slug: 'temple-neck',
    base_price: 185000,
    discount_pct: 5,
    colors: ['Traditional Gold'],
    weights: ['45g', '52g'],
    image_url: 'https://images.unsplash.com/photo-1599643478518-a784e5dc4c8f?w=800&auto=format&fit=crop',
  },
  {
    title: 'Kundan & Pearl Antique Choker',
    description: 'An antique-finish gold choker set encrusted with fine Kundan glass polkis, bordered by layers of hand-strung basra pearls. Complemented with matching jhumkas.',
    type: 'jewellery',
    sub_category_slug: 'choker',
    base_price: 145000,
    discount_pct: 10,
    colors: ['Antique Gold'],
    weights: ['38g'],
    image_url: 'https://images.unsplash.com/photo-1602751584552-8ba73aad10e1?w=800&auto=format&fit=crop',
  },
  {
    title: '22k Gold Nakshi Bangles (Pair)',
    description: 'A pair of handcrafted 22k gold bangles featuring detailed Nakshi work portraying floral vines and peacock motifs. Finished with screw closures.',
    type: 'jewellery',
    sub_category_slug: 'bangles',
    base_price: 98000,
    discount_pct: 0,
    colors: ['Traditional Yellow Gold'],
    weights: ['24g', '28g'],
    image_url: 'https://images.unsplash.com/photo-1601121141461-9d6647bca1ed?w=800&auto=format&fit=crop',
  },
  {
    title: 'Filigree Gold Jhumka Earrings',
    description: 'Stunning double-layered gold jhumkas crafted with delicate filigree work, featuring tiny ruby accents and pearl drop hangings.',
    type: 'jewellery',
    sub_category_slug: 'jhumkas',
    base_price: 45000,
    discount_pct: 12,
    colors: ['Polished Gold'],
    weights: ['12g', '15g'],
    image_url: 'https://images.unsplash.com/photo-1635767798638-3e25273a8236?w=800&auto=format&fit=crop',
  },
]

async function seed() {
  console.log('--- DATABASE SEEDING STARTED ---')

  // 1. Insert subcategories
  console.log('Upserting subcategories...')
  const subCategoryMap: Record<string, string> = {}

  for (const sub of SUB_CATEGORIES) {
    const { data, error } = await supabase
      .from('categories')
      .upsert(
        { name: sub.name, slug: sub.slug, parent_id: sub.parent_id },
        { onConflict: 'slug' }
      )
      .select('id, slug')
      .single()

    if (error) {
      console.error(`Error seeding category ${sub.name}:`, error.message)
    } else if (data) {
      console.log(`Seeded category: ${sub.name} (${data.id})`)
      subCategoryMap[sub.slug] = data.id
    }
  }

  // 2. Fetch an admin user profile to assign to products (optional, if required, otherwise null is fine)
  let adminId: string | null = null
  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('role', 'admin')
    .limit(1)
    .single()
  
  if (profile) {
    adminId = profile.id
    console.log(`Using admin user ID: ${adminId}`)
  }

  // 3. Insert products
  console.log('Seeding products, images, and variants...')
  for (const prod of PRODUCTS) {
    const categoryId = subCategoryMap[prod.sub_category_slug]
    if (!categoryId) {
      console.warn(`Category ID not found for slug ${prod.sub_category_slug}, skipping product ${prod.title}`)
      continue
    }

    // Insert Product
    const { data: newProd, error: prodErr } = await supabase
      .from('products')
      .insert({
        title: prod.title,
        description: prod.description,
        type: prod.type,
        category_id: categoryId,
        base_price: prod.base_price,
        discount_pct: prod.discount_pct,
        created_by: adminId,
        published: true, // Make them active and visible on the shop by default!
      })
      .select('id')
      .single()

    if (prodErr || !newProd) {
      console.error(`Error inserting product ${prod.title}:`, prodErr?.message)
      continue
    }

    console.log(`Created product: ${prod.title} (${newProd.id})`)

    // Insert Product Image
    const { error: imgErr } = await supabase
      .from('product_images')
      .insert({
        product_id: newProd.id,
        url: prod.image_url,
        is_primary: true,
        alt_text: prod.title,
        display_order: 0
      })

    if (imgErr) {
      console.error(`Error inserting image for ${prod.title}:`, imgErr.message)
    }

    // Insert Variants
    const colors = prod.colors || ['Standard']
    const sizes = (prod as any).sizes || (prod as any).weights || ['One Size']

    for (const color of colors) {
      for (const size of sizes) {
        const sku = `SKU-${newProd.id.substring(0, 5)}-${color.substring(0, 3).toUpperCase()}-${size.replace(/\s+/g, '').toUpperCase()}`
        const { error: varErr } = await supabase
          .from('variants')
          .insert({
            product_id: newProd.id,
            color,
            size,
            quantity: 12, // generous stock
            sold_count: Math.floor(Math.random() * 5), // randomized mock sales count
            sku,
            image_url: prod.image_url
          })

        if (varErr) {
          console.error(`Error inserting variant ${sku} for ${prod.title}:`, varErr.message)
        }
      }
    }
  }

  console.log('--- DATABASE SEEDING COMPLETED SUCCESSFULLY ---')
}

seed()
