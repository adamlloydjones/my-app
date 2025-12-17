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
    // Parse the webhook payload from Printful v2
    const payload = JSON.parse(event.body);
    
    console.log('Received webhook:', payload);

    // V2 API uses 'type' field for event type
    if (payload.type !== 'shipment_sent') {
      return {
        statusCode: 200,
        body: JSON.stringify({ message: 'Event type not handled' })
      };
    }

    // Extract shipment and order details from v2 structure
    const shipment = payload.data;
    const order = shipment.order || {};
    
    const customerEmail = order.recipient?.email;
    const customerName = order.recipient?.name;
    const orderNumber = order.external_id || order.id;
    const trackingNumber = shipment.tracking_number;
    const trackingUrl = shipment.tracking_url;
    const carrier = shipment.carrier;
    
    // Extract shipped items
    const shippedItems = shipment.shipment_items || [];
    const itemsList = shippedItems.map(item => {
      const quantity = item.quantity || 1;
      const name = item.order_item_name || 'Item';
      return `${quantity}x ${name}`;
    }).join(', ');
    
    const itemsCount = shippedItems.reduce((sum, item) => sum + (item.quantity || 0), 0);

    if (!customerEmail) {
      console.error('No customer email found in webhook');
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'No customer email in payload' })
      };
    }

    // Get the group ID for "order-shipped" group
    // You'll need to add this to your environment variables
    const groupId = process.env.SENDER_GROUP_ID; // e.g., "abc123"

    if (!groupId) {
      console.error('SENDER_GROUP_ID not configured');
      return {
        statusCode: 500,
        body: JSON.stringify({ 
          error: 'SENDER_GROUP_ID environment variable not set',
          note: 'Please add your Sender group ID to environment variables'
        })
      };
    }

    // Add subscriber to the "order-shipped" group with tracking data
    const senderResponse = await fetch('https://api.sender.net/v2/subscribers', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.SENDER_API_KEY}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        email: customerEmail,
        firstname: customerName?.split(' ')[0] || '',
        lastname: customerName?.split(' ').slice(1).join(' ') || '',
        groups: [groupId], // Add to the "order-shipped" group
        fields: {
          order_number: orderNumber,
          tracking_number: trackingNumber,
          tracking_url: trackingUrl,
          carrier: carrier,
          items_shipped: itemsList,
          items_count: itemsCount.toString()
        },
        trigger_automation: true // This will trigger the automation immediately
      })
    });

    if (!senderResponse.ok) {
      const errorText = await senderResponse.text();
      console.error('Sender API error:', senderResponse.status, errorText);
      
      // If subscriber already exists (409), try to update them
      if (senderResponse.status === 409) {
        console.log('Subscriber exists, updating...');
        
        // Update existing subscriber and add to group
        const updateResponse = await fetch(`https://api.sender.net/v2/subscribers`, {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${process.env.SENDER_API_KEY}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify({
            email: customerEmail,
            groups: [groupId],
            fields: {
              order_number: orderNumber,
              tracking_number: trackingNumber,
              tracking_url: trackingUrl,
              carrier: carrier,
              items_shipped: itemsList,
              items_count: itemsCount.toString()
            }
          })
        });

        if (!updateResponse.ok) {
          const updateError = await updateResponse.text();
          throw new Error(`Failed to update subscriber: ${updateResponse.status} - ${updateError}`);
        }
        
        console.log('Subscriber updated and added to group');
      } else {
        throw new Error(`Sender API failed: ${senderResponse.status} - ${errorText}`);
      }
    } else {
      console.log('Subscriber added to order-shipped group successfully');
    }

    const result = await senderResponse.json().catch(() => ({}));
    console.log('Sender API response:', result);

    return {
      statusCode: 200,
      body: JSON.stringify({ 
        success: true, 
        message: 'Customer added to order-shipped group, automation will trigger',
        orderId: orderNumber,
        email: customerEmail
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