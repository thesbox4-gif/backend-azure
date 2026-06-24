import { Request, Response } from 'express'

export function getWhatsAppSettings(_req: Request, res: Response) {
  res.json({
    phone: process.env.WHATSAPP_BUSINESS_PHONE ?? '',
    catalogueUrl: process.env.WHATSAPP_CATALOGUE_URL ?? '',
    defaultMessage:
      process.env.WHATSAPP_DEFAULT_MESSAGE ??
      'Hi Yuvarani Silks, I would like to view your latest saree and jewellery catalogue.',
  })
}
