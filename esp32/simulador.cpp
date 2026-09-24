#include <iostream>
#include <fstream>

int main()
{
    // Dados que o ESP32 está "medindo"
    double temperatura = 26.5;
    int aquecimento = 65;
    int alimentacao = 0;

    // Envia os dados para o Python
    std::ofstream dados("dados.txt");

    if (!dados.is_open())
    {
        std::cout << "Erro ao criar dados.txt" << std::endl;
        return 1;
    }

    dados << "temperatura=" << temperatura << std::endl;
    dados << "aquecimento=" << aquecimento << std::endl;
    dados << "alimentacao=" << alimentacao << std::endl;

    dados.close();

    std::cout << "Dados enviados pelo ESP32:" << std::endl;
    std::cout << "Temperatura: " << temperatura << " °C" << std::endl;
    std::cout << "Aquecimento: " << aquecimento << "%" << std::endl;
    std::cout << "Alimentacao: " << alimentacao << std::endl;

    return 0;
}