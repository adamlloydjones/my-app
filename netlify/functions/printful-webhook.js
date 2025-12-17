// netlify/functions/printful-webhook.js

exports.handler = async (event, context) => {
  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    // Parse the webhook payload
    const payload = JSON.parse(event.body);
    
    console.log('Received webhook:', payload);

    // Verify it's a shipped order event
    if (payload.type !== 'package_shipped') {
      return {
        statusCode: 200,
        body: JSON.stringify({ message: 'Event type not handled' })
      };
    }

    // Extract order details
    const order = payload.data.order;
    const shipment = payload.data.shipment;
    
    const customerEmail = order.recipient.email;
    const customerName = order.recipient.name;
    const orderNumber = order.external_id || order.id;
    const trackingNumber = shipment.tracking_number;
    const trackingUrl = shipment.tracking_url;
    const carrier = shipment.carrier;

    // Prepare email data for Sender
    const emailData = {
      to: [{ email: customerEmail, name: customerName }],
      subject: `Your order #${orderNumber} has shipped! 📦`,
      html: `
        <h2>Great news, ${customerName}!</h2>
        <p>Your order <strong>#${orderNumber}</strong> has been shipped and is on its way to you.</p>
        
        <h3>Tracking Information:</h3>
        <p><strong>Carrier:</strong> ${carrier}</p>
        <p><strong>Tracking Number:</strong> ${trackingNumber}</p>
        ${trackingUrl ? `<p><a href="${trackingUrl}" style="background-color: #4CAF50; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">Track Your Package</a></p>` : ''}
        
        <p>Thank you for your order!</p>
      `,
      from: {
        email: process.env.SENDER_FROM_EMAIL,
        name: process.env.SENDER_FROM_NAME || 'Your Store'
      }
    };

    // Send email via Sender API
    const senderResponse = await fetch('https://api.sender.net/v2/email', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.SENDER_API_KEY}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(emailData)
    });

    if (!senderResponse.ok) {
      const errorText = await senderResponse.text();
      console.error('Sender API error:', errorText);
      throw new Error(`Sender API failed: ${senderResponse.status}`);
    }

    const senderResult = await senderResponse.json();
    console.log('Email sent successfully:', senderResult);

    return {
      statusCode: 200,
      body: JSON.stringify({ 
        success: true, 
        message: 'Email sent successfully',
        orderId: orderNumber 
      })
    };

  } catch (error) {
    console.error('Error processing webhook:', error);
    
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: 'Failed to process webhook',
        message: error.message 
      })
    };
  }
};