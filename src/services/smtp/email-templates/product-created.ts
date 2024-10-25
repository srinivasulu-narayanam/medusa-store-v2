export const productCreated = {
    subject: "New Product Created",
    body: `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>New   
   Product Created</title>
        <style>
            /* Your CSS styles here */
            body {
                font-family: Arial, sans-serif;
            }
            h1 {
                color: #333;
            }
            p {
                color: #666;
            }
        </style>
    </head>
    <body>
        <h1>A new product has been created!</h1>
        <p>Product details:</p>
        <ul>
            <li>ID: {{ product.id }}</li>
        </ul>
    </body>
    </html>
    `,
  };