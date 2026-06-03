import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'

dotenv.config()

const supabaseUrl = process.env.SUPABASE_URL || ''
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

const supabase = createClient(supabaseUrl, supabaseKey)

async function inspect() {
  console.log('Fetching categories...')
  const { data: categories, error: catError } = await supabase
    .from('categories')
    .select('*')
  
  if (catError) {
    console.error('Error categories:', catError)
  } else {
    console.log('Categories count:', categories?.length)
    console.log(JSON.stringify(categories, null, 2))
  }

  console.log('Fetching products...')
  const { data: products, error: prodError } = await supabase
    .from('products')
    .select('id, title, type, category_id, base_price')
    .limit(10)
  
  if (prodError) {
    console.error('Error products:', prodError)
  } else {
    console.log('Products sample count:', products?.length)
    console.log(JSON.stringify(products, null, 2))
  }
}

inspect()
