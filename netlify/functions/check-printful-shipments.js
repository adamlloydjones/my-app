// netlify/functions/check-printful-shipments.js
//
// This function polls Printful API for recently shipped orders
// and sends email notifications via Sender.net
// 
// Schedule this to run every hour using Netlify Scheduled Functions
// or use a cron service like cron-job.org to trigger it

// const fetch = require('node-fetch');

// Environment variables needed:
// PRINTFUL_API_KEY - Your Printful API key
// SENDER_API_KEY - Your Sender.net API key
// SENDER_FROM_EMAIL - Your sender email
// SENDER_FROM_NAME - Your sender name

exports.handler = async (event, context) => {
  console.log('🔍 Checking Printful for shipped orders...');

  try {
    const printfulApiKey = process.env.PRINTFUL_API_KEY;
    const senderApiKey = process.env.SENDER_API_KEY;

    if (!printfulApiKey || !senderApiKey) {
      return {
        statusCode: 500,
        body: JSON.stringify({ 
          error: 'Missing API keys',
          details: 'Set PRINTFUL_API_KEY and SENDER_API_KEY in environment variables'
        })
      };
    }

    // Fetch orders from last 24 hours with status 'shipped'
    const orders = await fetchRecentShippedOrders(printfulApiKey);
    console.log(`📦 Found ${orders.length} shipped orders`);

    let emailsSent = 0;
    let errors = 0;

    // Check each order and send email if not already sent
    for (const order of orders) {
      try {
        // Check if we've already sent email for this order
        const alreadySent = await checkIfEmailSent(order.id);
        
        if (alreadySent) {
          console.log(`⏭️  Skipping order ${order.id} - email already sent`);
          continue;
        }

        // Get shipment details
        const shipmentInfo = await getShipmentInfo(printfulApiKey, order.id);
        
        if (!shipmentInfo) {
          console.log(`⚠️  No shipment info for order ${order.id}`);
          continue;
        }

        // Send email
        const emailResult = await sendShipmentEmail(
          senderApiKey,
          order,
          shipmentInfo
        );

        if (emailResult.success) {
          console.log(`✅ Email sent for order ${order.id}`);
          await markEmailAsSent(order.id);
          emailsSent++;
        } else {
          console.error(`❌ Failed to send email for order ${order.id}:`, emailResult.error);
          errors++;
        }

      } catch (error) {
        console.error(`❌ Error processing order ${order.id}:`, error);
        errors++;
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Check completed',
        ordersFound: orders.length,
        emailsSent,
        errors
      })
    };

  } catch (error) {
    console.error('❌ Fatal error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: 'Internal error',
        message: error.message 
      })
    };
  }
};

/**
 * Fetch orders shipped in the last 24 hours from Printful
 */
async function fetchRecentShippedOrders(apiKey) {
  try {
    const response = await fetch('https://api.printful.com/orders', {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      params: {
        status: 'fulfilled', // shipped orders
        limit: 100
      }
    });

    if (!response.ok) {
      console.error('Printful API error:', response.status);
      return [];
    }

    const data = await response.json();
    const orders = data.result || [];

    // Filter for orders shipped in last 24 hours
    const twentyFourHoursAgo = Date.now() - (24 * 60 * 60 * 1000);
    
    return orders.filter(order => {
      if (!order.shipments || order.shipments.length === 0) {
        return false;
      }
      
      const shipmentDate = new Date(order.shipments[0].shipped_at || order.updated);
      return shipmentDate.getTime() > twentyFourHoursAgo;
    });

  } catch (error) {
    console.error('Error fetching Printful orders:', error);
    return [];
  }
}

/**
 * Get detailed shipment info for an order
 */
async function getShipmentInfo(apiKey, orderId) {
  try {
    const response = await fetch(`https://api.printful.com/orders/${orderId}`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    const order = data.result;

    if (!order.shipments || order.shipments.length === 0) {
      return null;
    }

    const shipment = order.shipments[0];

    return {
      orderId: order.id,
      externalId: order.external_id,
      customerEmail: order.recipient.email,
      customerName: order.recipient.name,
      trackingNumber: shipment.tracking_number,
      trackingUrl: shipment.tracking_url,
      carrier: shipment.carrier,
      service: shipment.service,
      items: order.items.map(item => ({
        name: item.name,
        quantity: item.quantity,
        variant: item.variant_name
      }))
    };

  } catch (error) {
    console.error('Error getting shipment info:', error);
    return null;
  }
}

/**
 * Send shipment notification email via Sender.net
 */
async function sendShipmentEmail(apiKey, order, shipmentInfo) {
  const fromEmail = process.env.SENDER_FROM_EMAIL || 'orders@yourdomain.com';
  const fromName = process.env.SENDER_FROM_NAME || 'Your Store';

  // Build items list
  const itemsHtml = shipmentInfo.items.map(item => `
    <li style="margin-bottom: 8px;">
      <strong>${item.name}</strong>
      ${item.variant ? `<span style="color: #666;"> - ${item.variant}</span>` : ''}
      <span style="color: #666;"> (Qty: ${item.quantity})</span>
    </li>
  `).join('');

  const trackingButtonHtml = shipmentInfo.trackingUrl 
    ? `<a href="${shipmentInfo.trackingUrl}" style="display: inline-block; background: #4CAF50; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: bold; margin: 20px 0;">Track Your Order</a>`
    : '';

  const emailHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
        <h1 style="margin: 0; font-size: 28px;">📦 Your Order Has Shipped!</h1>
      </div>
      
      <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px;">
        <p style="font-size: 16px; margin-top: 0;">Hi ${shipmentInfo.customerName},</p>
        
        <p style="font-size: 16px;">Great news! Your order has been dispatched and is on its way to you.</p>
        
        <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #4CAF50;">
          <h2 style="margin-top: 0; color: #333; font-size: 20px;">Shipment Details</h2>
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 8px 0; color: #666;">Order Number:</td>
              <td style="padding: 8px 0; font-weight: bold;">#${shipmentInfo.externalId || shipmentInfo.orderId}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #666;">Tracking Number:</td>
              <td style="padding: 8px 0; font-weight: bold;">${shipmentInfo.trackingNumber}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #666;">Carrier:</td>
              <td style="padding: 8px 0;">${shipmentInfo.carrier} ${shipmentInfo.service ? `(${shipmentInfo.service})` : ''}</td>
            </tr>
          </table>
        </div>

        <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <h3 style="margin-top: 0; color: #333; font-size: 18px;">Items in This Shipment</h3>
          <ul style="padding-left: 20px;">
            ${itemsHtml}
          </ul>
        </div>

        <div style="text-align: center; margin: 30px 0;">
          ${trackingButtonHtml}
        </div>

        <p style="font-size: 14px; color: #666; margin-top: 30px;">
          If you have any questions about your order, please don't hesitate to contact us.
        </p>

        <p style="font-size: 16px; margin-bottom: 0;">
          Thank you for shopping with us!<br>
          <strong>${fromName}</strong>
        </p>
      </div>

      <div style="text-align: center; padding: 20px; font-size: 12px; color: #999;">
        <p>This is an automated message. Please do not reply to this email.</p>
      </div>
    </body>
    </html>
  `;

  const payload = {
    to: [
      {
        email: shipmentInfo.customerEmail,
        name: shipmentInfo.customerName
      }
    ],
    from: {
      email: fromEmail,
      name: fromName
    },
    subject: `Your order #${shipmentInfo.externalId || shipmentInfo.orderId} has shipped! 📦`,
    html: emailHtml
  };

  try {
    const response = await fetch('https://api.sender.net/v2/email/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const result = await response.json();

    if (response.ok) {
      return { success: true, data: result };
    } else {
      return { 
        success: false, 
        error: result.message || 'Failed to send email'
      };
    }
  } catch (error) {
    return { 
      success: false, 
      error: error.message 
    };
  }
}

/**
 * Check if we've already sent an email for this order
 * Using Netlify's Blob storage to track sent emails
 */
async function checkIfEmailSent(orderId) {
  try {
    // Check if email was already sent using simple storage
    const { getStore } = await import('@netlify/blobs');
    const store = getStore('shipment-emails');
    
    const sent = await store.get(orderId);
    return sent === 'sent';
  } catch (error) {
    // If storage fails, assume not sent (will attempt to send)
    console.log('Storage check failed, assuming not sent');
    return false;
  }
}

/**
 * Mark email as sent for this order
 */
async function markEmailAsSent(orderId) {
  try {
    const { getStore } = await import('@netlify/blobs');
    const store = getStore('shipment-emails');
    
    await store.set(orderId, 'sent');
  } catch (error) {
    console.error('Failed to mark email as sent:', error);
  }
}