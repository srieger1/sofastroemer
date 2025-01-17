// filepath: /c:/Users/pauls/OneDrive/Dokumente/Hochschule Fulda/Master/AMC/webpack.config.js
import path from 'path';

export default {
  mode: 'development', // Fügen Sie diese Zeile hinzu
  entry: './src/main.ts',
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      },
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader'],
      },
    ],
  },
  resolve: {
    extensions: ['.ts', '.js'],
  },
  output: {
    filename: 'bundle.js',
    path: path.resolve(process.cwd(), 'dist'),
  },
  externals: {
    child_process: 'commonjs2 child_process',
  },  
};