import express from 'express';
const app = express();
const port = process.env.PORT || 8002;

app.use("/static", express.static('public'));

app.get( "/", (req, res) => {
    res.send('Hello world!');
});

app.listen( port, () => {
    console.log(`Server started at http://localhost:${port}`);
})